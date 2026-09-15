/**
 * 门店的「真实身份信息」——**唯一定义**。
 *
 * 为什么要单独成文件：主店的地址同时被三处用到——种子（新建库）、
 * demo/testing 分行的开通脚本、以及考勤地理围栏的锚点坐标。
 * 上一版把地址写死在 seed-core 里，开通脚本又自己拼了 "Lot 123, Jalan Test, <城市>"，
 * 于是同一个门店在不同地方有两套身份信息（生产上就是 No. 62 / No. 12 两个假地址）。
 *
 * 本文件必须保持**无副作用、无依赖**（脚本、服务端、客户端都能读）。
 */

export const MAIN_BRANCH_NAME = "D&Z Smart Workshop";
export const MAIN_BRANCH_CITY = "Petaling Jaya";
export const MAIN_BRANCH_ADDRESS = "B-10-7, 3 Two Square, 2, Jalan 19/1, Seksyen 19, 46300 Petaling Jaya, Selangor";

/**
 * 考勤地理围栏锚点。
 * 来源：Nominatim 与 Photon 两个独立地理编码服务对「3 Two Square, Petaling Jaya」
 * 给出同一坐标，并用反向地理编码确认该点落在 Jalan 19/1 / Seksyen 19 / 46300。
 */
export const MAIN_BRANCH_COORDS = { lat: 3.1111141, lng: 101.6316582 } as const;

/**
 * demo/testing 分行**暂与主店同址**（owner 2026-09-15 决定）。
 * 它是测试占位分行，没有独立门牌；等它有真实地址时，只改这里。
 */
export const DEMO_BRANCH_ADDRESS = MAIN_BRANCH_ADDRESS;
export const DEMO_BRANCH_CITY = MAIN_BRANCH_CITY;
export const DEMO_BRANCH_COORDS = MAIN_BRANCH_COORDS;
