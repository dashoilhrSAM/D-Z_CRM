/**
 * 平台域的**认证管理端口**（Supabase Auth 的 admin 面）。
 *
 * 为什么要单独抽一层（而不是在 service 里直接 `createAdminClient()`）：
 * `src/lib/auth/phone-identity.ts` 带了 `import "server-only"` —— 那是**对的**
 * （service role 的代码绝不能被客户端打包进去），但它同时意味着**任何脚本都 import 不了它**
 * （`server-only` 在纯 Node 里直接抛错）。而"开一家店"这件事必须能由 CLI 跑：
 * 管理台还没做之前的唯一入口就是运维在自己机器上执行。
 * 于是：外部依赖收进 provider（符合 AGENTS.md 的分层约定），service 只依赖**接口**。
 *
 * ⚠️ 本模块读 `SUPABASE_SERVICE_ROLE_KEY`，**只允许服务端/脚本**引用。
 * 守卫见 `tests/platform-auth-port.test.ts`（客户端文件引用它会红）。
 */
export interface AuthAdminUser {
  id: string;
  email: string;
}

export interface EnsureAuthUserInput {
  email: string;
  /** 仅在"新建账号"时使用；账号已存在时**绝不能**改他的密码（他可能在别家店用同一个账号） */
  password: string;
  name?: string;
}

export interface EnsureAuthUserResult {
  authId: string;
  /** true = 复用了一个已存在的账号（跨店账号：登录时会出现门店选择器） */
  reused: boolean;
}

export interface AuthAdminPort {
  /** 有就复用、没有就建。**不修改已存在账号的任何凭据。** */
  ensureUser(input: EnsureAuthUserInput): Promise<EnsureAuthUserResult>;
}

/** Supabase 实现：建号失败即视为"该邮箱已存在"，再从列表里找回来（createUser 不返回既有 id）。 */
export class SupabaseAuthAdmin implements AuthAdminPort {
  async ensureUser(input: EnsureAuthUserInput): Promise<EnsureAuthUserResult> {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("缺少 NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");

    const { createClient } = await import("@supabase/supabase-js");
    const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

    const email = input.email.trim().toLowerCase();
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: input.password,
      email_confirm: true,
      user_metadata: input.name ? { name: input.name } : undefined,
    });
    if (!error && data?.user?.id) return { authId: data.user.id, reused: false };

    // 邮箱已注册 → 找回既有账号（**不动密码**）
    const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const found = list?.users?.find((u) => (u.email ?? "").toLowerCase() === email);
    if (found) return { authId: found.id, reused: true };

    throw new Error(error?.message ? `Supabase 拒绝建号：${error.message}` : `无法为 ${email} 建或找到 auth 账号`);
  }
}

export const supabaseAuthAdmin = new SupabaseAuthAdmin();
