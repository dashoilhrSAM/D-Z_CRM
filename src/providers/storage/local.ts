import * as fs from "node:fs";
import * as path from "node:path";
import { isPrivateObjectKey, PRIVATE_OBJECT_PREFIX, type StorageProvider } from "../types";

/** LocalStorageProvider — files under ./storage (prototype stand-in for Supabase Storage). */
export class LocalStorageProvider implements StorageProvider {
  readonly name = "local-storage";
  private dir = path.join(process.cwd(), "storage");

  private ensureDir() {
    fs.mkdirSync(this.dir, { recursive: true });
  }

  async put(key: string, data: Uint8Array, contentType: string): Promise<string> {
    this.ensureDir();
    const safe = key.replace(/[^a-zA-Z0-9._-]/g, "_");
    const file = path.join(this.dir, safe);
    fs.writeFileSync(file, data);
    return "/api/storage/" + safe + (contentType === "image/jpeg" ? "" : "");
  }

  async get(key: string): Promise<Uint8Array | null> {
    this.ensureDir();
    const safe = key.replace(/[^a-zA-Z0-9._-]/g, "_");
    const file = path.join(this.dir, safe);
    if (!fs.existsSync(file)) return null;
    return fs.readFileSync(file);
  }

  /**
   * 私有对象的落盘路径：**允许嵌套目录**（考勤按 用户/日期 分目录），所以要逐级建目录。
   *
   * 公共对象的 put/get 刻意保持原来的扁平命名——那批文件已经躺在 ./storage 里、
   * URL 也被引用着，改命名规则会把它们读不出来。
   *
   * 另外挡一下路径穿越：键是应用自己拼的，但存储层不该假设调用方永远正确。
   */
  private privatePath(key: string): string {
    if (key.includes("..")) throw new Error("storage key must not contain ..");
    const safe = key.replace(/[^a-zA-Z0-9._/-]/g, "_");
    const file = path.resolve(this.dir, safe);
    if (!file.startsWith(path.resolve(this.dir) + path.sep)) throw new Error("storage key escapes the storage directory");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    return file;
  }

  /**
   * 私有对象在本地就是同一个目录、不同前缀：区别不在存储，而在**谁能读**——
   * 本地没有鉴权路由之外的出口，公共 /api/storage 已经把 private/ 前缀挡掉。
   */
  async putPrivate(key: string, data: Uint8Array, contentType: string): Promise<void> {
    if (!isPrivateObjectKey(key)) throw new Error("putPrivate: key must start with " + PRIVATE_OBJECT_PREFIX);
    fs.writeFileSync(this.privatePath(key), data);
  }

  async getPrivate(key: string): Promise<Uint8Array | null> {
    if (!isPrivateObjectKey(key)) return null;
    const file = this.privatePath(key);
    if (!fs.existsSync(file)) return null;
    return fs.readFileSync(file);
  }
}

export const storageProvider = new LocalStorageProvider();
