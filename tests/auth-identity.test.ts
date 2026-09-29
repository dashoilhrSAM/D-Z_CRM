// 请求身份：本地验签的映射规则 + 「不许再有每请求的 getUser」这条结构不变量。
//
// 为什么有这些测试（2026-09-29 P1 容量评估）：
//   auth.getUser() **每次调用都打一次 GoTrue**。原实现有三处热点：
//     · src/lib/supabase/middleware.ts（每个请求）
//     · src/lib/session-user.ts（每个页面/动作）
//     · src/lib/rider-customer.ts（rider 端点每个页面）
//   500 家门店的模型下这是 8,570 万次/月，而 Supabase 的 /auth/v1/user 默认
//   **按 IP 限流 30 次/5 分钟**，且所有请求来自同一小撮 Vercel 出口 IP。
//   改用 getClaims() 后是本地 WebCrypto 验签（本项目 ES256，JWKS 有公钥），稳态零网络。
//
// 三条断言各自能失败：
//   ① 映射规则写错（把没有 sub 的 claims 当成已登录）→ 单元断言红；
//   ② 有人把某处改回 getUser（或新增第四处）→ 结构断言红；
//   ③ 身份读取被复制成多份（两份规则必然漂移）→ 结构断言红。
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { identityFromClaims } from "@/lib/auth/request-identity";

const root = process.cwd();
const read = (p: string) => readFileSync(path.join(root, p), "utf8");
/** 只看代码不看注释：否则"注释里写着旧写法"会让守卫误报。 */
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("identityFromClaims：claims → 身份", () => {
  it("有 sub 才算已登录，并把 user_metadata 原样带出来（middleware 要靠它做路由隔离）", () => {
    const id = identityFromClaims({
      sub: "3f1c8f0e-0000-4000-8000-000000000001",
      email: "manager@dz.my",
      user_metadata: { role: "MANAGER", orgId: "org_1", branchId: "br_1" },
    });
    expect(id).not.toBeNull();
    expect(id!.id).toBe("3f1c8f0e-0000-4000-8000-000000000001");
    expect(id!.email).toBe("manager@dz.my");
    expect(id!.user_metadata.role).toBe("MANAGER");
    expect(id!.user_metadata.branchId).toBe("br_1");
  });

  it("没有 sub / sub 为空 = 没有身份（不能当成已登录）", () => {
    expect(identityFromClaims(null)).toBeNull();
    expect(identityFromClaims(undefined)).toBeNull();
    expect(identityFromClaims({})).toBeNull();
    expect(identityFromClaims({ sub: "" })).toBeNull();
    expect(identityFromClaims({ sub: 123 })).toBeNull();
  });

  it("user_metadata 不是对象时退化成空对象，而不是把脏数据透出去", () => {
    expect(identityFromClaims({ sub: "u1", user_metadata: "MANAGER" })!.user_metadata).toEqual({});
    expect(identityFromClaims({ sub: "u1", user_metadata: ["a"] })!.user_metadata).toEqual({});
    expect(identityFromClaims({ sub: "u1", user_metadata: null })!.user_metadata).toEqual({});
  });

  it("email 不是字符串就不给（claims 来自网络，类型要收）", () => {
    expect(identityFromClaims({ sub: "u1", email: 42 })!.email).toBeUndefined();
    expect(identityFromClaims({ sub: "u1" })!.email).toBeUndefined();
  });
});

describe("结构：身份只有一处定义，且不许再有每请求的 getUser", () => {
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const entry of readdirSync(path.join(root, dir))) {
      const rel = path.join(dir, entry);
      if (statSync(path.join(root, rel)).isDirectory()) walk(rel, out);
      else if (/\.tsx?$/.test(entry)) out.push(rel);
    }
    return out;
  };

  it("三处热点都用本地验签的身份，不再自己调 getUser", () => {
    const middleware = stripComments(read("src/lib/supabase/middleware.ts"));
    const sessionUser = stripComments(read("src/lib/session-user.ts"));
    const riderCustomer = stripComments(read("src/lib/rider-customer.ts"));
    for (const [name, src] of [["middleware", middleware], ["session-user", sessionUser], ["rider-customer", riderCustomer]] as const) {
      expect(src, name + " 不该再调 auth.getUser()").not.toContain("auth.getUser(");
    }
    // 身份映射只有一处定义：claims → 身份（edge 与 node 共用）
    expect(stripComments(read("src/lib/auth/request-identity.ts"))).toContain("identityFromClaims");
    // node 侧只有一处"向 Supabase Auth 要身份"的代码
    const identityReader = stripComments(read("src/lib/supabase/identity.ts"));
    expect(identityReader).toContain("getClaims(");
    expect(identityReader).toContain("identityFromClaims");
    // edge（middleware）自带一份 cookie 读写，但复用同一套映射
    expect(middleware).toContain("getClaims(");
    expect(middleware).toContain("identityFromClaims");
    // 两个 node 侧消费者都走同一个 reader，不各自复制一份
    expect(sessionUser).toContain("readRequestIdentity");
    expect(riderCustomer).toContain("readRequestIdentity");
  });

  it("全仓只允许「登录/凭据流程」里出现 getUser（新增第四处会让这条红）", () => {
    // 白名单：登录、改密码这类一次性凭据流程需要服务端权威校验，且不在热路径上。
    const ALLOWED = ["src/actions/auth-supabase.ts"];
    const offenders: string[] = [];
    for (const file of walk("src")) {
      const src = stripComments(read(file));
      if (src.includes("auth.getUser(") && !ALLOWED.includes(file)) offenders.push(file);
    }
    expect(offenders, "这些文件在热路径上调了 getUser（每请求一次 GoTrue）").toEqual([]);
    // 正向对照：白名单文件确实还在用（否则这条断言可能只是"什么都没匹配到"）
    expect(stripComments(read(ALLOWED[0]))).toContain("auth.getUser(");
  });
});
