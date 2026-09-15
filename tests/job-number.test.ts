// 工单号（DZ####）的序列守卫。
//
// 这里守三类事，每一类都对应一个真实发生过的失效：
//  A. 把字符串当数字用：DZ9999 在字符串序里**大于** DZ10000，于是"最大号"算成 DZ9999、
//     下一个发出 DZ10000 —— 那号已经存在，jobNumber 的唯一约束必然拒绝。过了 9999 号
//     就永久卡死（重试算出的还是同一个号，不会自愈）。本地确定性复现见 scenario D。
//  B. 号码来源不设防：别的格式（压测数据造出的 PERF900299）参与比较时，
//     replace(/\D/g,"") 会把前缀一起剥掉，算出 DZ900300 这种凭空跳号。
//  C. 并发：两笔同时算号会算出同一个号（编号是序列，没有条件更新可写），
//     所以"撞唯一约束就整笔重来"必须真的接在两条建单路径上。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  FIRST_JOB_NUMBER,
  JOB_NUMBER_ATTEMPTS,
  allocateJobNumber,
  isJobNumberConflict,
  nextJobNumberFrom,
  parseJobNumber,
  retryOnJobNumberConflict,
} from "@/lib/job-number";

const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");

/**
 * 修复前的算法，逐字抄自 origin/main（两份副本算的是同一个东西）。
 * 留着它只有一个用途：**证明这些输入真的能踩中旧缺陷**——
 * 否则下面的用例可能只是在测试一些旧代码本来就能通过的输入。
 */
const legacyNextJobNumber = (existing: string[]) => {
  const last = [...existing].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))[0];
  const base = last ? parseInt(last.replace(/\D/g, ""), 10) : 1023;
  return "DZ" + (isNaN(base) ? 1024 : base + 1);
};

describe("A. 按数值取最大，而不是按字符串", () => {
  const cliff = ["DZ9998", "DZ9999", "DZ10000"];

  it("反向验证：旧算法发的是已经存在的号（这条就是本次改动的由头）", () => {
    const legacy = legacyNextJobNumber(cliff);
    expect(legacy, "旧算法给出的号必须是 DZ10000，否则这些输入没踩中缺陷").toBe("DZ10000");
    expect(cliff, "而且它确实已经在库里").toContain(legacy);
  });

  it("新算法给的是 DZ10001", () => {
    expect(nextJobNumberFrom(cliff)).toBe("DZ10001");
  });

  it("跨数位仍然单调递增", () => {
    expect(nextJobNumberFrom(["DZ9999"])).toBe("DZ10000");
    expect(nextJobNumberFrom(["DZ10000"])).toBe("DZ10001");
    expect(nextJobNumberFrom(["DZ99999", "DZ100000"])).toBe("DZ100001");
  });
});

describe("B. 只认 DZ<十进制数> 格式的行", () => {
  it("反向验证：旧算法会被无关前缀带跑（压测库里真的发生）", () => {
    expect(legacyNextJobNumber(["DZ1024", "PERF900299"])).toBe("DZ900300");
  });

  it("新算法忽略无关格式，回到真实序列", () => {
    expect(nextJobNumberFrom(["DZ1024", "PERF900299"])).toBe("DZ1025");
  });

  it("parseJobNumber 不接受任何非号码写法", () => {
    expect(parseJobNumber("DZ1024")).toBe(1024);
    expect(parseJobNumber("  DZ1024  ")).toBe(1024);
    for (const bad of ["PERF900299", "DZ", "1024", "DZ1024A", "dz1024", "", "DZ-1024", "DZ1024/2"]) {
      expect(parseJobNumber(bad), bad + " 不该被当成工单号").toBeNull();
    }
  });
});

describe("空库与断号", () => {
  it("空库从 FIRST_JOB_NUMBER 起发", () => {
    expect(FIRST_JOB_NUMBER).toBe(1024);
    expect(nextJobNumberFrom([])).toBe("DZ1024");
  });

  it("被删掉的号不回收（编号只增不回填）", () => {
    expect(nextJobNumberFrom(["DZ1024", "DZ1030"])).toBe("DZ1031");
  });
});

describe("allocateJobNumber", () => {
  it("只取 jobNumber 一列，并把行交给同一套规则", async () => {
    const seen: unknown[] = [];
    const client = {
      serviceJob: {
        findMany: async (args: unknown) => {
          seen.push(args);
          return [{ jobNumber: "DZ9999" }, { jobNumber: "PERF900299" }];
        },
      },
    };
    await expect(allocateJobNumber(client as never)).resolves.toBe("DZ10000");
    expect(seen[0], "必须只 select jobNumber，不要把整行读出来").toEqual({ select: { jobNumber: true } });
  });
});

describe("C. 撞唯一约束就重来", () => {
  const p2002 = (target?: unknown) =>
    Object.assign(new Error("Unique constraint failed on the fields: (`jobNumber`)"), {
      code: "P2002",
      meta: target === undefined ? {} : { target },
    });

  it("只认指向 jobNumber 的 P2002", () => {
    expect(isJobNumberConflict(p2002(["jobNumber"]))).toBe(true);
    expect(isJobNumberConflict(p2002("jobNumber"))).toBe(true);
    expect(isJobNumberConflict(p2002(["Booking_jobId_key"])), "别的唯一约束不该被重试").toBe(false);
    expect(isJobNumberConflict(p2002()), "没给 target 时按撞号处理").toBe(true);
    expect(isJobNumberConflict(new Error("network down"))).toBe(false);
    expect(isJobNumberConflict({ code: "P2025" })).toBe(false);
    expect(isJobNumberConflict(null)).toBe(false);
  });

  it("输的那笔重算，赢的号被让开", async () => {
    let attempt = 0;
    const result = await retryOnJobNumberConflict(async () => {
      attempt++;
      if (attempt === 1) throw p2002(["jobNumber"]);
      return "DZ10002";
    });
    expect(result).toBe("DZ10002");
    expect(attempt).toBe(2);
  });

  it("别的错立刻抛，不重试（重试不该掩盖真正的失败）", async () => {
    let calls = 0;
    await expect(
      retryOnJobNumberConflict(async () => {
        calls++;
        throw new Error("别的错");
      }),
    ).rejects.toThrow("别的错");
    expect(calls).toBe(1);
  });

  it("一直撞就撞到上限为止，不会无限重试", async () => {
    let calls = 0;
    await expect(
      retryOnJobNumberConflict(async () => {
        calls++;
        throw p2002(["jobNumber"]);
      }),
    ).rejects.toMatchObject({ code: "P2002" });
    expect(calls).toBe(JOB_NUMBER_ATTEMPTS);
  });
});

describe("D. 号码的定义只有一处，且两条建单路径都接了重试", () => {
  const repo = read("src/repositories/prisma/jobs.repository.ts");
  const counter = read("src/modules/service-jobs/service.ts");
  const checkin = read("src/modules/bookings/service.ts");

  it("「按字符串排序取最大号」这个写法已经不存在", () => {
    for (const [name, src] of [["仓库", repo], ["柜台建单", counter], ["预约 check-in", checkin]] as const) {
      expect(src, name + " 里还在按 jobNumber 字符串倒序取最大号").not.toContain('orderBy: { jobNumber: "desc" }');
    }
  });

  it("仓库只转发，自己不再算号", () => {
    expect(repo).toContain("allocateJobNumber(");
    expect(repo, "仓库里不该再有拼接号码的算术").not.toMatch(/jobNumber\s*=\s*"DZ"/);
  });

  it("两条建单路径都用同一份分配，且都接了撞号重试", () => {
    expect(counter).toContain("retryOnJobNumberConflict(");
    expect(counter).toContain("nextJobNumber(");
    expect(checkin).toContain("retryOnJobNumberConflict(");
    expect(checkin).toContain("allocateJobNumber(");
    expect(checkin, "check-in 里不该再自己算号").not.toMatch(/jobNumber\s*=\s*"DZ"/);
  });
});
