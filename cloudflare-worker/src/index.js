/**
 * Cloudflare Worker 入口點
 * 
 * 導出 Durable Object 類別並將 WebSocket / REST API 請求路由至單例 BossRoom。
 */

import { BossRoom } from "./bossRoom.js";

// 必須在主模組導出 Durable Object 類別
export { BossRoom };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 處理 CORS 預檢
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    // 取得全域唯一的 BossRoom 實例 (單例模式，讓所有玩家與連線共享同一個房間狀態)
    const roomId = env.BOSS_ROOM.idFromName("global-loa-boss-room");
    const room = env.BOSS_ROOM.get(roomId);

    // 1. WebSocket 連線端點 (/ws)
    if (url.pathname === "/ws") {
      return room.fetch(request);
    }

    // 2. 外部 REST API 端點 (/api/...)
    if (url.pathname.startsWith("/api/")) {
      return room.fetch(request);
    }

    // 3. 根路徑狀態提示
    if (url.pathname === "/") {
      return new Response(
        JSON.stringify(
          {
            project: "LOA Boss Time - Cloudflare Worker Backend",
            status: "Running",
            endpoints: {
              websocket: "/ws",
              status_api: "/api/status",
              boss_data_api: "/api/boss-data",
              boss_death_webhook: "POST /api/boss-death",
            },
            timestamp: new Date().toISOString(),
          },
          null,
          2
        ),
        {
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }

    return new Response("Not Found", { status: 404 });
  },
};
