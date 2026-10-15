/**
 * Cloudflare Worker 入口點
 * 
 * 導出 Durable Object 類別並將 WebSocket / REST API 請求路由至單例 BossRoom。
 */

import { BossRoom } from "./bossRoom.js";
import {
  exchangeDiscordCode,
  getDiscordUser,
  checkChannelPermission,
  createJwt,
  verifyJwt,
  DEFAULT_TARGET_GUILD_ID,
  DEFAULT_TARGET_CHANNEL_ID,
} from "./auth.js";

// 必須在主模組導出 Durable Object 類別
export { BossRoom };

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...CORS_HEADERS,
    },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 處理 CORS 預檢
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: CORS_HEADERS,
      });
    }

    // 處理 Discord OAuth2 與 身分權限驗證 API (/api/auth/...)
    if (url.pathname.startsWith("/api/auth/")) {
      // 1. 取得前端設定 (Client ID 等)
      if (url.pathname === "/api/auth/config" && request.method === "GET") {
        return jsonResponse({
          clientId: env.DISCORD_CLIENT_ID || "",
          guildId: env.DISCORD_TARGET_GUILD_ID || DEFAULT_TARGET_GUILD_ID,
          channelId: env.DISCORD_TARGET_CHANNEL_ID || DEFAULT_TARGET_CHANNEL_ID,
        });
      }

      // 2. Token 有效性校驗
      if (url.pathname === "/api/auth/verify") {
        const authHeader = request.headers.get("Authorization") || "";
        const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
        if (!token) {
          return jsonResponse({ success: false, reason: "未提供認證憑證" }, 401);
        }

        const userPayload = await verifyJwt(token, env.AUTH_JWT_SECRET);
        if (!userPayload) {
          return jsonResponse({ success: false, reason: "認證憑證已過期或無效" }, 401);
        }

        return jsonResponse({
          success: true,
          user: {
            id: userPayload.id,
            username: userPayload.username,
            global_name: userPayload.global_name,
            nickname: userPayload.nickname || null,
            displayName: userPayload.displayName || userPayload.nickname || userPayload.global_name || userPayload.username,
            avatar: userPayload.avatar,
          },
        });
      }

      // 3. Discord 授權碼登入與權限檢查
      if (url.pathname === "/api/auth/discord/login" && request.method === "POST") {
        try {
          const body = await request.json().catch(() => ({}));
          const { code, redirect_uri } = body;

          if (!code || !redirect_uri) {
            return jsonResponse(
              { success: false, reason: "缺少必要參數 (code 或 redirect_uri)" },
              400
            );
          }

          if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET || !env.DISCORD_BOT_TOKEN) {
            return jsonResponse(
              {
                success: false,
                reason: "伺服器尚未配置 Discord 金鑰變數 (DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_BOT_TOKEN)",
              },
              500
            );
          }

          // A. 交換 Token
          const tokenData = await exchangeDiscordCode(
            code,
            redirect_uri,
            env.DISCORD_CLIENT_ID,
            env.DISCORD_CLIENT_SECRET
          );

          // B. 取得使用者資訊
          const discordUser = await getDiscordUser(tokenData.access_token);

          // C. 檢查指定頻道存取權限
          const guildId = env.DISCORD_TARGET_GUILD_ID || DEFAULT_TARGET_GUILD_ID;
          const channelId = env.DISCORD_TARGET_CHANNEL_ID || DEFAULT_TARGET_CHANNEL_ID;

          const checkResult = await checkChannelPermission({
            guildId,
            channelId,
            userId: discordUser.id,
            botToken: env.DISCORD_BOT_TOKEN,
          });

          if (!checkResult.allowed) {
            return jsonResponse(
              {
                success: false,
                reason: checkResult.reason || "權限不足，無法存取此系統",
                user: {
                  id: discordUser.id,
                  username: discordUser.username,
                  global_name: discordUser.global_name,
                  avatar: discordUser.avatar,
                },
              },
              403
            );
          }

          // D. 簽發 7 天有效期的 JWT
          const memberNick = checkResult.member?.nick || null;
          const displayName = memberNick || discordUser.global_name || discordUser.username;

          const jwtPayload = {
            id: discordUser.id,
            username: discordUser.username,
            global_name: discordUser.global_name,
            nickname: memberNick,
            displayName: displayName,
            avatar: discordUser.avatar,
            exp: Math.floor(Date.now() / 1000) + 7 * 86400,
          };

          const jwtToken = await createJwt(jwtPayload, env.AUTH_JWT_SECRET);

          return jsonResponse({
            success: true,
            token: jwtToken,
            user: {
              id: discordUser.id,
              username: discordUser.username,
              global_name: discordUser.global_name,
              nickname: memberNick,
              displayName: displayName,
              avatar: discordUser.avatar,
            },
          });
        } catch (err) {
          console.error("登入驗證過程發生異常:", err);
          return jsonResponse(
            { success: false, reason: err.message || "登入驗證過程發生錯誤" },
            500
          );
        }
      }

      return jsonResponse({ success: false, reason: "找不到該認證端點" }, 404);
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
