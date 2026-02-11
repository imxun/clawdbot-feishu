import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import {
  FeishuCalendarSchema,
  type FeishuCalendarParams,
} from "./calendar-schema.js";
import { listEnabledFeishuAccounts } from "./accounts.js";
import { resolveToolsConfig } from "./tools-config.js";
import {
  storeUserToken,
  getUserAccessToken,
  invalidateUserToken,
  isUserTokenExpiredCode,
  UserTokenExpiredError,
  UserTokenNotFoundError,
} from "./user-token.js";
import type { FeishuClientCredentials } from "./client.js";

const FEISHU_API_BASE = "https://open.feishu.cn/open-apis";

function json(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    details: data,
  };
}

// ============ HTTP Helper ============

async function feishuRequest<T = any>(
  userAccessToken: string,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  params?: Record<string, string | number | boolean | undefined>,
  body?: unknown
): Promise<T> {
  const url = new URL(`${FEISHU_API_BASE}${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const options: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${userAccessToken}`,
      "Content-Type": "application/json",
    },
  };

  if (body && (method === "POST" || method === "PATCH")) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url.toString(), options);
  const data = await response.json();

  if (data.code !== 0) {
    if (isUserTokenExpiredCode(data.code)) {
      throw new UserTokenExpiredError(
        `user_access_token 已过期或无效，请提供新的 token。错误: ${data.msg}`
      );
    }
    throw new Error(data.msg || `API error: ${data.code}`);
  }

  return data;
}

// ============ Token-aware request wrapper ============

/**
 * 带自动 token 刷新的请求包装器。
 * 1. 从缓存获取 token（可能自动刷新）
 * 2. 发起请求
 * 3. 如果请求中遇到 token 过期，标记失效后重试一次
 */
async function feishuRequestWithTokenRefresh<T = any>(
  creds: FeishuClientCredentials,
  accountId: string | undefined,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  params?: Record<string, string | number | boolean | undefined>,
  body?: unknown
): Promise<T> {
  const { token } = await getUserAccessToken({ accountId, creds });

  try {
    return await feishuRequest<T>(token, method, path, params, body);
  } catch (err) {
    if (err instanceof UserTokenExpiredError) {
      // token 在请求过程中过期，标记失效并重试一次
      invalidateUserToken(accountId);
      const refreshed = await getUserAccessToken({ accountId, creds });
      return await feishuRequest<T>(refreshed.token, method, path, params, body);
    }
    throw err;
  }
}

// ============ Core Functions ============

async function getPrimaryCalendar(
  creds: FeishuClientCredentials,
  accountId?: string
) {
  const res = await feishuRequestWithTokenRefresh(
    creds,
    accountId,
    "POST",
    "/calendar/v4/calendars/primary",
    { user_id_type: "user_id" }
  );

  const calendar = res.data?.calendars?.[0]?.calendar;
  if (!calendar?.calendar_id) {
    throw new Error("无法获取主日历");
  }

  return {
    calendar_id: calendar.calendar_id,
    summary: calendar.summary,
    description: calendar.description,
    type: calendar.type,
    role: calendar.role,
  };
}

async function listEvents(
  creds: FeishuClientCredentials,
  accountId: string | undefined,
  calendarId: string | undefined,
  startTime: string,
  endTime: string,
  pageSize?: number,
  pageToken?: string
) {
  let calId = calendarId;
  if (!calId) {
    const primary = await getPrimaryCalendar(creds, accountId);
    calId = primary.calendar_id;
  }

  const res = await feishuRequestWithTokenRefresh(
    creds,
    accountId,
    "GET",
    `/calendar/v4/calendars/${encodeURIComponent(calId)}/events`,
    {
      start_time: startTime,
      end_time: endTime,
      page_size: pageSize ?? 50,
      page_token: pageToken,
      user_id_type: "user_id",
    }
  );

  const items = res.data?.items ?? [];
  const startTs = parseInt(startTime);
  const endTs = parseInt(endTime);

  // 过滤已取消的日程
  // 重复性日程（有 recurrence 字段）信任 API 返回结果
  const activeEvents = items.filter((e: any) => {
    if (e.status === "cancelled") return false;
    if (e.recurrence) return true;
    const eventStartTs = parseInt(e.start_time?.timestamp || "0");
    return eventStartTs >= startTs && eventStartTs < endTs;
  });

  return {
    calendar_id: calId,
    events: activeEvents.map((e: any) => ({
      event_id: e.event_id,
      summary: e.summary ?? "(无标题)",
      description: e.description,
      start_time: e.start_time,
      end_time: e.end_time,
      status: e.status,
      organizer: e.event_organizer?.display_name,
      location: e.location?.name,
      meeting_url: e.vchat?.meeting_url,
      app_link: e.app_link,
      recurrence: e.recurrence,
      free_busy_status: e.free_busy_status,
    })),
    total: activeEvents.length,
    has_more: res.data?.has_more ?? false,
    page_token: res.data?.page_token,
    sync_token: res.data?.sync_token,
  };
}

async function getEvent(
  creds: FeishuClientCredentials,
  accountId: string | undefined,
  calendarId: string,
  eventId: string
) {
  const res = await feishuRequestWithTokenRefresh(
    creds,
    accountId,
    "GET",
    `/calendar/v4/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { user_id_type: "user_id" }
  );

  const e = res.data?.event;
  if (!e) {
    throw new Error("日程不存在");
  }

  return {
    event_id: e.event_id,
    summary: e.summary ?? "(无标题)",
    description: e.description,
    start_time: e.start_time,
    end_time: e.end_time,
    status: e.status,
    organizer: e.event_organizer?.display_name,
    attendees: e.attendees,
    location: e.location,
    meeting_url: e.vchat?.meeting_url,
    recurrence: e.recurrence,
    reminders: e.reminders,
    visibility: e.visibility,
    app_link: e.app_link,
  };
}

async function searchEvents(
  creds: FeishuClientCredentials,
  accountId: string | undefined,
  calendarId: string | undefined,
  query: string,
  startTime?: string,
  endTime?: string
) {
  let calId = calendarId;
  if (!calId) {
    const primary = await getPrimaryCalendar(creds, accountId);
    calId = primary.calendar_id;
  }

  const body: any = { query };
  if (startTime || endTime) {
    body.filter = {};
    if (startTime) body.filter.start_time = { timestamp: startTime };
    if (endTime) body.filter.end_time = { timestamp: endTime };
  }

  const res = await feishuRequestWithTokenRefresh(
    creds,
    accountId,
    "POST",
    `/calendar/v4/calendars/${encodeURIComponent(calId)}/events/search`,
    { user_id_type: "user_id" },
    body
  );

  const items = res.data?.items ?? [];

  return {
    calendar_id: calId,
    events: items.map((e: any) => ({
      event_id: e.event_id,
      summary: e.summary ?? "(无标题)",
      description: e.description,
      start_time: e.start_time,
      end_time: e.end_time,
      status: e.status,
      organizer: e.event_organizer?.display_name,
    })),
    total: items.length,
  };
}

async function createEvent(
  creds: FeishuClientCredentials,
  accountId: string | undefined,
  calendarId: string | undefined,
  summary: string,
  startTime: string,
  endTime: string,
  options: {
    description?: string;
    location?: string;
    need_notification?: boolean;
    reminders?: number[];
    recurrence?: string;
    attendee_ability?: string;
    free_busy_status?: string;
    visibility?: string;
  } = {}
) {
  let calId = calendarId;
  if (!calId) {
    const primary = await getPrimaryCalendar(creds, accountId);
    calId = primary.calendar_id;
  }

  const body: any = {
    summary,
    start_time: {
      timestamp: startTime,
      timezone: "Asia/Shanghai",
    },
    end_time: {
      timestamp: endTime,
      timezone: "Asia/Shanghai",
    },
  };

  if (options.description) body.description = options.description;
  if (options.location) body.location = { name: options.location };
  if (options.need_notification !== undefined)
    body.need_notification = options.need_notification;
  if (options.reminders)
    body.reminders = options.reminders.map((m) => ({ minutes: m }));
  if (options.recurrence) body.recurrence = options.recurrence;
  if (options.attendee_ability) body.attendee_ability = options.attendee_ability;
  if (options.free_busy_status) body.free_busy_status = options.free_busy_status;
  if (options.visibility) body.visibility = options.visibility;

  const res = await feishuRequestWithTokenRefresh(
    creds,
    accountId,
    "POST",
    `/calendar/v4/calendars/${encodeURIComponent(calId)}/events`,
    { user_id_type: "user_id" },
    body
  );

  const e = res.data?.event;
  return {
    success: true,
    calendar_id: calId,
    event_id: e?.event_id,
    summary: e?.summary,
    start_time: e?.start_time,
    end_time: e?.end_time,
    app_link: e?.app_link,
  };
}

async function updateEvent(
  creds: FeishuClientCredentials,
  accountId: string | undefined,
  calendarId: string,
  eventId: string,
  updates: {
    summary?: string;
    start_time?: string;
    end_time?: string;
    description?: string;
    location?: string;
    need_notification?: boolean;
  }
) {
  const body: any = {};

  if (updates.summary) body.summary = updates.summary;
  if (updates.description) body.description = updates.description;
  if (updates.location) body.location = { name: updates.location };
  if (updates.need_notification !== undefined)
    body.need_notification = updates.need_notification;
  if (updates.start_time) {
    body.start_time = {
      timestamp: updates.start_time,
      timezone: "Asia/Shanghai",
    };
  }
  if (updates.end_time) {
    body.end_time = {
      timestamp: updates.end_time,
      timezone: "Asia/Shanghai",
    };
  }

  const res = await feishuRequestWithTokenRefresh(
    creds,
    accountId,
    "PATCH",
    `/calendar/v4/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { user_id_type: "user_id" },
    body
  );

  const e = res.data?.event;
  return {
    success: true,
    event_id: e?.event_id,
    summary: e?.summary,
    start_time: e?.start_time,
    end_time: e?.end_time,
    app_link: e?.app_link,
  };
}

async function deleteEvent(
  creds: FeishuClientCredentials,
  accountId: string | undefined,
  calendarId: string,
  eventId: string,
  needNotification: boolean = false
) {
  await feishuRequestWithTokenRefresh(
    creds,
    accountId,
    "DELETE",
    `/calendar/v4/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { need_notification: needNotification }
  );

  return {
    success: true,
    deleted_event_id: eventId,
  };
}

// ============ Tool Registration ============

export function registerFeishuCalendarTools(api: OpenClawPluginApi) {
  if (!api.config) {
    api.logger.debug?.("feishu_calendar: No config available, skipping");
    return;
  }

  const accounts = listEnabledFeishuAccounts(api.config);
  if (accounts.length === 0) {
    api.logger.debug?.("feishu_calendar: No Feishu accounts configured");
    return;
  }

  const firstAccount = accounts[0];
  const toolsCfg = resolveToolsConfig(firstAccount.config.tools);

  if (!toolsCfg.calendar) {
    api.logger.debug?.("feishu_calendar: Calendar tools disabled");
    return;
  }

  // 应用凭证，用于 refresh_token 续期时获取 app_access_token
  const creds: FeishuClientCredentials = {
    accountId: firstAccount.accountId,
    appId: firstAccount.appId,
    appSecret: firstAccount.appSecret,
    domain: firstAccount.domain,
  };

  api.registerTool(
    {
      name: "feishu_calendar",
      label: "Feishu Calendar",
      description:
        "飞书日历操作（需要用户提供 user_access_token）。Actions: get_primary(获取主日历), list_events(日程列表), get_event(日程详情), search_events(搜索), create_event(创建), update_event(更新), delete_event(删除)",
      parameters: FeishuCalendarSchema,
      async execute(_toolCallId, params) {
        const p = params as FeishuCalendarParams;
        const accountId = firstAccount.accountId;

        try {
          // 每次调用时存储用户传入的 token（更新缓存）
          storeUserToken({
            accountId,
            userAccessToken: p.user_access_token,
            refreshToken: (p as any).refresh_token,
          });

          switch (p.action) {
            case "get_primary":
              return json(await getPrimaryCalendar(creds, accountId));
            case "list_events":
              return json(
                await listEvents(
                  creds,
                  accountId,
                  p.calendar_id,
                  p.start_time,
                  p.end_time,
                  p.page_size,
                  p.page_token
                )
              );
            case "get_event":
              return json(
                await getEvent(
                  creds,
                  accountId,
                  p.calendar_id,
                  p.event_id
                )
              );
            case "search_events":
              return json(
                await searchEvents(
                  creds,
                  accountId,
                  p.calendar_id,
                  p.query,
                  p.start_time,
                  p.end_time
                )
              );
            case "create_event":
              return json(
                await createEvent(
                  creds,
                  accountId,
                  p.calendar_id,
                  p.summary,
                  p.start_time,
                  p.end_time,
                  {
                    description: p.description,
                    location: p.location,
                    need_notification: p.need_notification,
                    reminders: p.reminders,
                    recurrence: p.recurrence,
                    attendee_ability: p.attendee_ability,
                    free_busy_status: p.free_busy_status,
                    visibility: p.visibility,
                  }
                )
              );
            case "update_event":
              return json(
                await updateEvent(
                  creds,
                  accountId,
                  p.calendar_id,
                  p.event_id,
                  {
                    summary: p.summary,
                    start_time: p.start_time,
                    end_time: p.end_time,
                    description: p.description,
                    location: p.location,
                    need_notification: p.need_notification,
                  }
                )
              );
            case "delete_event":
              return json(
                await deleteEvent(
                  creds,
                  accountId,
                  p.calendar_id,
                  p.event_id,
                  p.need_notification
                )
              );
            default:
              return json({ error: `Unknown action: ${(p as any).action}` });
          }
        } catch (err) {
          if (
            err instanceof UserTokenExpiredError ||
            err instanceof UserTokenNotFoundError
          ) {
            return json({
              error: err.message,
              token_expired: true,
              hint: "请提供新的 user_access_token（以 u- 开头）",
            });
          }
          const errorMsg = err instanceof Error ? err.message : String(err);
          return json({ error: errorMsg });
        }
      },
    },
    { name: "feishu_calendar" }
  );

  api.logger.info?.("feishu_calendar: Registered feishu_calendar");
}
