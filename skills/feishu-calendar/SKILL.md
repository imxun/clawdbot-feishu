---
name: feishu-calendar
description: Feishu calendar operations using user_access_token. Activate when user mentions calendar, schedule, events, or meeting times.
---

# Feishu Calendar Tool

使用 `user_access_token` 获取用户日历和日程信息。

**重要**:
- 日历功能必须使用用户级 `user_access_token`（以 `u-` 开头）
- 不能使用机器人应用的 `app_key` 访问用户个人日程
- 插件内置 refresh_token 自动续期机制，用户提供一次 token 后可自动续期约30天

## Token 管理流程（必须严格遵守）

### 自动续期机制

插件使用 `src/user-token.ts` 公共模块管理 token 生命周期：

- `user_access_token` 有效期 ~2小时，过期后自动用 `refresh_token` 续期
- `refresh_token` 有效期 ~30天，过期后需要用户重新提供
- 续期通过飞书 OIDC 接口完成，使用应用的 `app_access_token` 鉴权
- 每次续期后 `refresh_token` 会变化，插件自动更新缓存

### 执行任何日历操作前，必须按以下流程检查 Token:

1. **检查全局记忆**
   - 使用 `/remember list` 查找 `feishu_user_access_token` 和 `feishu_refresh_token`
   - 如果找到，提取 token 值

2. **调用日历工具**
   - 使用记忆中的 token 调用日历操作
   - 插件会自动处理 token 刷新（无需手动干预）
   - 如果返回 `token_expired: true`，说明 refresh_token 也已过期，进入步骤 3

3. **请求用户提供新 Token**
   - 仅在以下情况提示用户:
     - 全局记忆中没有 token
     - 返回结果包含 `token_expired: true`（refresh_token 过期，约30天后）
   - 提示: "您的 token 已过期，请提供新的 user_access_token 和 refresh_token"
   - 说明获取方式:
     ```
     获取 token 的方法:
     1. 访问飞书开放平台控制台
     2. 进入应用的【凭证与基础信息】页面
     3. 确认已添加日历相关权限（calendar:calendar, calendar:calendar:readonly）
     4. 使用【调试工具】或【OAuth 2.0】获取 user_access_token 和 refresh_token
     ```

4. **保存 Token 到全局记忆**
   - 用户提供 token 后，立即保存:
     ```
     /remember feishu_user_access_token=u-xxxxxxxxxxxxxx
     /remember feishu_refresh_token=ur-xxxxxxxxxxxxxx
     ```
   - 重新执行步骤 2

### Token 管理示例

```
# 首次使用
用户: "查看我今天的日程"
助手:
  1. 检查 /remember list → 未找到 feishu_user_access_token
  2. 提示: "请提供 user_access_token 和 refresh_token"

用户: "user_access_token: u-xxx, refresh_token: ur-xxx"
助手:
  1. /remember feishu_user_access_token=u-xxx
  2. /remember feishu_refresh_token=ur-xxx
  3. 调用 list_events 查询今日日程（插件自动管理 token 续期）

# 30天内再次使用（token 自动续期，用户无感）
用户: "查看明天的日程"
助手:
  1. 检查 /remember list → 找到 token
  2. 直接调用 list_events（插件自动刷新过期的 user_access_token）

# 30天后 refresh_token 过期
用户: "查看日程"
助手:
  1. 调用工具 → 返回 token_expired: true
  2. 提示: "您的授权已过期（约30天），请重新提供 token"
```

## 标准使用流程

1. **Token 检查** (从全局记忆获取，或请求用户提供)
2. 调用 `get_primary` 获取主日历 `calendar_id`
3. 使用 `calendar_id` 调用其他操作

## Actions

### 获取主日历（前置步骤）

```json
{
  "action": "get_primary",
  "user_access_token": "u-xxxxx"
}
```

返回: `calendar_id`, `summary`(日历名称), `type`, `role`

### 获取日程列表

```json
{
  "action": "list_events",
  "user_access_token": "u-xxxxx",
  "start_time": "1769961600",
  "end_time": "1770566399"
}
```

指定日历（可选）:
```json
{
  "action": "list_events",
  "user_access_token": "u-xxxxx",
  "calendar_id": "feishu.cn_xxx@group.calendar.feishu.cn",
  "start_time": "1769961600",
  "end_time": "1770566399",
  "page_size": 50
}
```

**注意**:
- 时间为 Unix 时间戳（秒）
- 如果不提供 `calendar_id`，自动获取主日历
- 已取消的日程会被自动过滤
- 重复性日程会被过滤，只保留实际发生在时间范围内的日程

返回: 日程列表，包含 `summary`, `start_time`, `end_time`, `organizer`, `meeting_url`, `recurrence`, `free_busy_status` 等

### 获取日程详情

```json
{
  "action": "get_event",
  "user_access_token": "u-xxxxx",
  "calendar_id": "feishu.cn_xxx@group.calendar.feishu.cn",
  "event_id": "a8e131a1-3747-48e2-a808-683cdbcddf0b_0"
}
```

返回: 完整日程信息，包含参与者、提醒、重复规则等

### 搜索日程

```json
{
  "action": "search_events",
  "user_access_token": "u-xxxxx",
  "query": "周会"
}
```

带时间范围:
```json
{
  "action": "search_events",
  "user_access_token": "u-xxxxx",
  "query": "周会",
  "start_time": "1769961600",
  "end_time": "1770566399"
}
```

### 创建日程

```json
{
  "action": "create_event",
  "user_access_token": "u-xxxxx",
  "summary": "团队周会",
  "start_time": "1770048000",
  "end_time": "1770051600"
}
```

完整参数:
```json
{
  "action": "create_event",
  "user_access_token": "u-xxxxx",
  "calendar_id": "feishu.cn_xxx@group.calendar.feishu.cn",
  "summary": "团队周会",
  "start_time": "1770048000",
  "end_time": "1770051600",
  "description": "讨论项目进展",
  "location": "301会议室",
  "need_notification": true,
  "reminders": [5, 15],
  "recurrence": "FREQ=WEEKLY;INTERVAL=1;BYDAY=TH",
  "attendee_ability": "can_see_others",
  "free_busy_status": "busy",
  "visibility": "default"
}
```

**参数说明**:
| 参数 | 必填 | 说明 |
|------|------|------|
| `summary` | ✅ | 日程标题 |
| `start_time` | ✅ | 开始时间（Unix 时间戳秒） |
| `end_time` | ✅ | 结束时间（Unix 时间戳秒） |
| `calendar_id` | ❌ | 日历 ID，不填使用主日历 |
| `description` | ❌ | 日程描述 |
| `location` | ❌ | 地点名称 |
| `need_notification` | ❌ | 是否发送通知，默认 true |
| `reminders` | ❌ | 提醒时间数组（分钟），如 `[5, 15]` |
| `recurrence` | ❌ | 重复规则（RFC 5545 格式） |
| `attendee_ability` | ❌ | 参与人权限: none/can_see_others/can_invite_others/can_modify_event |
| `free_busy_status` | ❌ | 忙闲状态: busy/free |
| `visibility` | ❌ | 可见性: default/public/private |

返回: `event_id`, `summary`, `start_time`, `end_time`, `app_link`

### 更新日程

```json
{
  "action": "update_event",
  "user_access_token": "u-xxxxx",
  "calendar_id": "feishu.cn_xxx@group.calendar.feishu.cn",
  "event_id": "a8e131a1-3747-48e2-a808-683cdbcddf0b_0",
  "summary": "团队周会（改期）",
  "start_time": "1770134400",
  "end_time": "1770138000",
  "description": "讨论项目进展",
  "location": "401会议室",
  "need_notification": true
}
```

**注意**: `calendar_id` 和 `event_id` 为必填参数。

### 删除日程

```json
{
  "action": "delete_event",
  "user_access_token": "u-xxxxx",
  "calendar_id": "feishu.cn_xxx@group.calendar.feishu.cn",
  "event_id": "a8e131a1-3747-48e2-a808-683cdbcddf0b_0"
}
```

发送取消通知:
```json
{
  "action": "delete_event",
  "user_access_token": "u-xxxxx",
  "calendar_id": "feishu.cn_xxx@group.calendar.feishu.cn",
  "event_id": "a8e131a1-3747-48e2-a808-683cdbcddf0b_0",
  "need_notification": true
}
```

## 重复规则 (recurrence)

使用 RFC 5545 格式的 RRULE 规则:

| 规则 | 说明 |
|------|------|
| `FREQ=DAILY;INTERVAL=1` | 每天 |
| `FREQ=WEEKLY;INTERVAL=1` | 每周 |
| `FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE,FR` | 每周一、三、五 |
| `FREQ=WEEKLY;INTERVAL=2;BYDAY=TH` | 每两周的周四 |
| `FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=15` | 每月15日 |

## 时间格式

所有时间参数使用 **Unix 时间戳（秒）**。

常用时间戳示例（北京时间）：
| 日期 | 时间戳 |
|------|--------|
| 2026-02-02 00:00 | 1769961600 |
| 2026-02-08 23:59 | 1770566399 |

## 典型工作流

### 查看本周日程

```
1. get_primary → 获取 calendar_id
2. list_events → 使用本周时间范围查询
```

### 搜索特定会议

```
1. search_events → 使用关键词搜索
2. get_event → 获取详细信息（如需要）
```

## 返回字段说明

| 字段 | 说明 |
|------|------|
| `summary` | 日程标题 |
| `start_time` | 开始时间（含 timestamp 和 timezone） |
| `end_time` | 结束时间 |
| `organizer` | 组织者姓名 |
| `meeting_url` | 会议链接（如有） |
| `app_link` | 飞书 App 跳转链接 |
| `status` | 状态：confirmed/cancelled |
| `recurrence` | 重复规则（如 FREQ=WEEKLY） |
| `free_busy_status` | 忙闲状态 |

## API 说明

根据飞书官方文档：
- `start_time` 和 `end_time` 用于查询指定时间范围的日程
- `anchor_time` 用于增量拉取，**不可与 start_time/end_time 一起使用**
- 重复性日程：API 可能返回历史记录，工具会自动过滤只保留范围内的日程

## 配置

```yaml
channels:
  feishu:
    tools:
      calendar: true  # 默认启用
```

## 权限要求

用户的 `user_access_token` 需要具有日历读取权限。
