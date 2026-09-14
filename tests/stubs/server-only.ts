// vitest 用的 server-only 替身。
//
// 真实的 server-only 包在"浏览器条件"下会直接抛错（这正是它的作用：阻止把服务端模块
// import 进客户端组件）。而 vitest 跑在 node 环境里却按浏览器条件解析它，于是任何测试
// 只要 import 一个带 `import "server-only"` 的模块（src/lib/auth/permissions.ts 就是）
// 就会整个 suite 失败 —— 真正被检测的"客户端/服务端边界"其实由 next build 负责，
// 测试环境没有这个边界可言。所以这里给测试一个空替身，见 vitest.config.ts 的 alias。
export {};
