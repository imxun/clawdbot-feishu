import { Type, type Static } from "@sinclair/typebox";

// 时间对象 Schema
const TimeSchema = Type.Object({
  timestamp: Type.String({ description: "Unix时间戳(秒)" }),
  timezone: Type.Optional(
    Type.String({ description: "时区，默认 Asia/Shanghai" })
  ),
});

export const FeishuCalendarSchema = Type.Union([
  // 获取主日历信息（前置步骤，获取 calendar_id）
  Type.Object({
    action: Type.Literal("get_primary"),
    user_access_token: Type.String({
      description: "用户访问令牌 (user_access_token)，以 u- 开头",
    }),
  }),
  // 获取日程列表
  Type.Object({
    action: Type.Literal("list_events"),
    user_access_token: Type.String({
      description: "用户访问令牌 (user_access_token)，以 u- 开头",
    }),
    calendar_id: Type.Optional(
      Type.String({
        description: "日历ID，不填则自动获取主日历",
      })
    ),
    start_time: Type.String({ description: "开始时间，Unix时间戳(秒)" }),
    end_time: Type.String({ description: "结束时间，Unix时间戳(秒)" }),
    page_size: Type.Optional(
      Type.Number({ description: "每页数量，默认50" })
    ),
    page_token: Type.Optional(Type.String({ description: "分页标记" })),
  }),
  // 获取日程详情
  Type.Object({
    action: Type.Literal("get_event"),
    user_access_token: Type.String({
      description: "用户访问令牌 (user_access_token)，以 u- 开头",
    }),
    calendar_id: Type.String({ description: "日历ID" }),
    event_id: Type.String({ description: "日程ID" }),
  }),
  // 搜索日程
  Type.Object({
    action: Type.Literal("search_events"),
    user_access_token: Type.String({
      description: "用户访问令牌 (user_access_token)，以 u- 开头",
    }),
    calendar_id: Type.Optional(
      Type.String({
        description: "日历ID，不填则自动获取主日历",
      })
    ),
    query: Type.String({ description: "搜索关键词" }),
    start_time: Type.Optional(
      Type.String({ description: "开始时间，Unix时间戳(秒)" })
    ),
    end_time: Type.Optional(
      Type.String({ description: "结束时间，Unix时间戳(秒)" })
    ),
  }),
  // 创建日程
  Type.Object({
    action: Type.Literal("create_event"),
    user_access_token: Type.String({
      description: "用户访问令牌 (user_access_token)，以 u- 开头",
    }),
    calendar_id: Type.Optional(
      Type.String({
        description: "日历ID，不填则使用主日历",
      })
    ),
    summary: Type.String({ description: "日程标题" }),
    start_time: Type.String({ description: "开始时间，Unix时间戳(秒)" }),
    end_time: Type.String({ description: "结束时间，Unix时间戳(秒)" }),
    description: Type.Optional(Type.String({ description: "日程描述" })),
    location: Type.Optional(Type.String({ description: "地点名称" })),
    need_notification: Type.Optional(
      Type.Boolean({ description: "是否发送通知，默认 true" })
    ),
    reminders: Type.Optional(
      Type.Array(Type.Number(), {
        description: "提醒时间（分钟），如 [5, 15] 表示提前5分钟和15分钟提醒",
      })
    ),
    recurrence: Type.Optional(
      Type.String({
        description:
          "重复规则，如 FREQ=WEEKLY;INTERVAL=1;BYDAY=TH 表示每周四",
      })
    ),
    attendee_ability: Type.Optional(
      Type.String({
        description:
          "参与人权限: none/can_see_others/can_invite_others/can_modify_event",
      })
    ),
    free_busy_status: Type.Optional(
      Type.String({ description: "忙闲状态: busy/free" })
    ),
    visibility: Type.Optional(
      Type.String({ description: "可见性: default/public/private" })
    ),
  }),
  // 更新日程
  Type.Object({
    action: Type.Literal("update_event"),
    user_access_token: Type.String({
      description: "用户访问令牌 (user_access_token)，以 u- 开头",
    }),
    calendar_id: Type.String({ description: "日历ID" }),
    event_id: Type.String({ description: "日程ID" }),
    summary: Type.Optional(Type.String({ description: "日程标题" })),
    start_time: Type.Optional(
      Type.String({ description: "开始时间，Unix时间戳(秒)" })
    ),
    end_time: Type.Optional(
      Type.String({ description: "结束时间，Unix时间戳(秒)" })
    ),
    description: Type.Optional(Type.String({ description: "日程描述" })),
    location: Type.Optional(Type.String({ description: "地点名称" })),
    need_notification: Type.Optional(
      Type.Boolean({ description: "是否发送通知" })
    ),
  }),
  // 删除日程
  Type.Object({
    action: Type.Literal("delete_event"),
    user_access_token: Type.String({
      description: "用户访问令牌 (user_access_token)，以 u- 开头",
    }),
    calendar_id: Type.String({ description: "日历ID" }),
    event_id: Type.String({ description: "日程ID" }),
    need_notification: Type.Optional(
      Type.Boolean({ description: "是否发送取消通知，默认 false" })
    ),
  }),
]);

export type FeishuCalendarParams = Static<typeof FeishuCalendarSchema>;
