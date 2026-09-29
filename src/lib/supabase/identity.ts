import "server-only";
import { createClient } from "@/lib/supabase/server";
import { identityFromClaims, type RequestIdentity } from "@/lib/auth/request-identity";

/**
 * 当前请求的身份。**唯一**一处 node 侧向 Supabase Auth 要身份的代码。
 *
 * 用 getClaims()（本地验签）而不是 getUser()（每次打一次 GoTrue）——
 * 详见 src/lib/auth/request-identity.ts 的说明。任何失败都当成"没有身份"，
 * 与原先 getUser() 抛错时的分支一致（会话过期/refresh token 失效/项目迁移后的旧会话）。
 *
 * middleware 在 edge 运行时另有自己的一份（要读写 cookie），但它复用同一套
 * identityFromClaims 映射，所以"什么算已登录"两处只有一个定义。
 */
export async function readRequestIdentity(): Promise<RequestIdentity | null> {
  const supabase = await createClient();
  try {
    const { data } = await supabase.auth.getClaims();
    return identityFromClaims(data?.claims);
  } catch {
    return null;
  }
}
