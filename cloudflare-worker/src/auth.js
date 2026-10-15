/**
 * Discord OAuth2 登入與頻道檢視權限驗證模組
 * 
 * 支援功能：
 * 1. Discord OAuth2 授權碼交換
 * 2. 獲取使用者個人資料
 * 3. 使用 Bot Token 檢查目標伺服器中特定頻道的 VIEW_CHANNEL 權限
 * 4. 原生 Web Crypto (HMAC-SHA256) JWT 簽署與校驗
 */

const PERM_ADMINISTRATOR = 0x8n;
const PERM_VIEW_CHANNEL = 0x400n;

// 預設目標 Guild 與 Channel
export const DEFAULT_TARGET_GUILD_ID = "1198482702932914277";
export const DEFAULT_TARGET_CHANNEL_ID = "1426495371332292608";

/**
 * Base64URL 編碼輔助函式
 */
function base64UrlEncode(str) {
  const bytes = typeof str === "string" ? new TextEncoder().encode(str) : str;
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Base64URL 解碼輔助函式
 */
function base64UrlDecode(str) {
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) {
    base64 += "=";
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * 取得環境中的 Web Crypto Subtle 實例 (相容 Cloudflare Worker 與 Node.js)
 */
async function getCryptoSubtle() {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    return crypto.subtle;
  }
  if (typeof globalThis !== "undefined" && globalThis.crypto && globalThis.crypto.subtle) {
    return globalThis.crypto.subtle;
  }
  const nodeCrypto = await import("node:crypto");
  return nodeCrypto.webcrypto.subtle;
}

/**
 * 簽發 JWT Token (使用原生 Web Crypto HMAC-SHA256)
 */
export async function createJwt(payload, secretKey) {
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const data = `${encodedHeader}.${encodedPayload}`;

  const subtle = await getCryptoSubtle();
  const key = await subtle.importKey(
    "raw",
    new TextEncoder().encode(secretKey || "loa-boss-default-secret-key-change-me"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(data)
  );

  const encodedSignature = base64UrlEncode(new Uint8Array(signature));
  return `${data}.${encodedSignature}`;
}

/**
 * 驗證 JWT Token
 */
export async function verifyJwt(token, secretKey) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const data = `${encodedHeader}.${encodedPayload}`;

  try {
    const subtle = await getCryptoSubtle();
    const key = await subtle.importKey(
      "raw",
      new TextEncoder().encode(secretKey || "loa-boss-default-secret-key-change-me"),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );

    const signature = base64UrlDecode(encodedSignature);
    const isValid = await subtle.verify(
      "HMAC",
      key,
      signature,
      new TextEncoder().encode(data)
    );

    if (!isValid) return null;

    const payloadJson = new TextDecoder().decode(base64UrlDecode(encodedPayload));
    const payload = JSON.parse(payloadJson);

    // 檢查過期時間
    if (payload.exp && Date.now() / 1000 > payload.exp) {
      return null;
    }

    return payload;
  } catch (err) {
    console.error("JWT 驗證失敗:", err);
    return null;
  }
}

/**
 * 向 Discord 交換 OAuth2 Access Token
 */
export async function exchangeDiscordCode(code, redirectUri, clientId, clientSecret) {
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "authorization_code",
    code: code,
    redirect_uri: redirectUri,
  });

  const response = await fetch("https://discord.com/api/v10/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Discord Token 交換失敗:", response.status, errorText);
    throw new Error(`無法換取 Discord 存取憑證: ${response.statusText}`);
  }

  return await response.json();
}

/**
 * 取得 Discord 使用者資訊
 */
export async function getDiscordUser(accessToken) {
  const response = await fetch("https://discord.com/api/v10/users/@me", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error("無法取得 Discord 使用者資訊");
  }

  return await response.json();
}

/**
 * 檢查使用者是否具備指定頻道的檢視權限 (完全遵循 Discord 官方權限階層與繼承規範)
 */
export async function checkChannelPermission({
  guildId,
  channelId,
  userId,
  botToken,
}) {
  const headers = {
    Authorization: `Bot ${botToken}`,
    "Content-Type": "application/json",
  };

  // 1. 取得伺服器基本資料 (檢查伺服器擁有者 Owner)
  let guildOwnerId = null;
  try {
    const guildRes = await fetch(`https://discord.com/api/v10/guilds/${guildId}`, { headers });
    if (guildRes.ok) {
      const guild = await guildRes.json();
      guildOwnerId = guild.owner_id;
    }
  } catch (e) {
    console.warn("[AUTH] 取得 Guild 資訊警告:", e);
  }

  // 伺服器擁有者具備所有最高權限
  if (guildOwnerId && guildOwnerId === userId) {
    return {
      allowed: true,
      reason: "通過 (伺服器擁有者)",
    };
  }

  // 2. 取得目標伺服器成員資料 (檢查是否在伺服器中以及擁有哪些角色)
  const memberRes = await fetch(
    `https://discord.com/api/v10/guilds/${guildId}/members/${userId}`,
    { headers }
  );

  if (memberRes.status === 404) {
    return {
      allowed: false,
      reason: "您的 Discord 帳號尚未加入目標伺服器",
    };
  }

  if (!memberRes.ok) {
    const errText = await memberRes.text();
    console.error("取得伺服器成員失敗:", memberRes.status, errText);
    return {
      allowed: false,
      reason: "無法驗證伺服器成員身分 (請確認 Bot 是否在伺服器中並擁有適當權限)",
    };
  }

  const member = await memberRes.json();
  const userRoles = member.roles || [];

  // 3. 取得目標伺服器所有角色資料
  const rolesRes = await fetch(
    `https://discord.com/api/v10/guilds/${guildId}/roles`,
    { headers }
  );

  if (!rolesRes.ok) {
    return {
      allowed: false,
      reason: "無法讀取伺服器角色權限資料",
    };
  }

  const allRoles = await rolesRes.json();
  const roleMap = new Map(allRoles.map((r) => [r.id, r]));

  // 4. 計算基礎權限 (Base Permissions: @everyone 權限加上使用者所有角色的權限)
  const everyoneRole = roleMap.get(guildId);
  let permissions = BigInt(everyoneRole ? everyoneRole.permissions : "0");

  for (const roleId of userRoles) {
    const role = roleMap.get(roleId);
    if (role) {
      permissions |= BigInt(role.permissions);
    }
  }

  // 若使用者擁有 Administrator (0x8)，直接具備所有頻道權限
  if ((permissions & PERM_ADMINISTRATOR) === PERM_ADMINISTRATOR) {
    return {
      allowed: true,
      reason: "通過 (具備管理員權限)",
      member,
    };
  }

  // 5. 取得目標頻道資訊 (包括其 parent_id 分類)
  const channelRes = await fetch(
    `https://discord.com/api/v10/channels/${channelId}`,
    { headers }
  );

  if (!channelRes.ok) {
    return {
      allowed: false,
      reason: "無法讀取目標頻道資訊 (請確認 Bot 是否擁有檢視目標頻道的權限)",
    };
  }

  const channel = await channelRes.json();
  const channelOverwrites = channel.permission_overwrites || [];

  // 輔助函式：套用權限覆寫 (依序套用 @everyone -> 身分組 -> 個人)
  function applyOverwrites(perms, overwritesList) {
    if (!overwritesList || overwritesList.length === 0) return perms;

    // A. 套用 @everyone 覆寫
    const everyoneOverwrite = overwritesList.find((o) => o.id === guildId);
    if (everyoneOverwrite) {
      perms &= ~BigInt(everyoneOverwrite.deny);
      perms |= BigInt(everyoneOverwrite.allow);
    }

    // B. 套用使用者的角色覆寫 (聯集 allow / deny)
    let rolesAllow = 0n;
    let rolesDeny = 0n;
    for (const roleId of userRoles) {
      const overwrite = overwritesList.find((o) => o.id === roleId);
      if (overwrite) {
        rolesAllow |= BigInt(overwrite.allow);
        rolesDeny |= BigInt(overwrite.deny);
      }
    }
    perms &= ~rolesDeny;
    perms |= rolesAllow;

    // C. 套用個人專屬覆寫 (Member Overwrite)
    const memberOverwrite = overwritesList.find((o) => o.id === userId);
    if (memberOverwrite) {
      perms &= ~BigInt(memberOverwrite.deny);
      perms |= BigInt(memberOverwrite.allow);
    }

    return perms;
  }

  // 6. 若頻道屬於某個分類 (Category, parent_id)，先行套用分類的權限覆寫
  if (channel.parent_id) {
    try {
      const parentRes = await fetch(
        `https://discord.com/api/v10/channels/${channel.parent_id}`,
        { headers }
      );
      if (parentRes.ok) {
        const parentChannel = await parentRes.json();
        permissions = applyOverwrites(permissions, parentChannel.permission_overwrites || []);
      }
    } catch (e) {
      console.warn("[AUTH] 取得父分類權限警告:", e);
    }
  }

  // 7. 套用頻道本身設定的權限覆寫
  permissions = applyOverwrites(permissions, channelOverwrites);

  // 8. 判定 VIEW_CHANNEL 權限 (0x400)
  const canView = (permissions & PERM_VIEW_CHANNEL) === PERM_VIEW_CHANNEL;

  console.log(`[AUTH_RESULT] 使用者: ${member.user?.username || userId}, 最終權限: 0x${permissions.toString(16)}, VIEW_CHANNEL: ${canView}`);

  return {
    allowed: canView,
    reason: canView ? "通過" : "您的帳號沒有檢視該頻道的權限",
    member,
  };
}
