CREATE TABLE IF NOT EXISTS note_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  name VARCHAR(200) NOT NULL,
  description VARCHAR(500),
  category VARCHAR(50) NOT NULL,
  content TEXT NOT NULL,
  is_system BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_note_templates_user_id ON note_templates(user_id);

-- System templates
INSERT INTO note_templates (user_id, name, description, category, content, is_system) VALUES
(NULL, '会议记录', '标准会议纪要模板', 'meeting',
$$# 会议记录

**日期：** {date}
**参会人：** {attendees}
**主持人：** {host}

## 议题

1.
2.

## 讨论内容



## 决议



## 待办事项

- [ ]
- [ ]

## 下次会议

**时间：**
**议题：**
$$, true),

(NULL, '周报', '每周工作总结模板', 'report',
$$# 周报

**姓名：** {name}
**日期：** {date}
**本周关键词：**

## 本周完成

1.
2.

## 进行中

1.
2.

## 遇到的问题



## 下周计划

1.
2.

## 需要的支持


$$, true),

(NULL, '项目计划', '项目管理计划模板', 'plan',
$$# 项目计划

**项目名称：**
**负责人：**
**开始日期：** {date}
**预计完成：**

## 项目目标



## 关键里程碑

| 阶段 | 目标 | 截止日期 | 状态 |
|------|------|----------|------|
| 1    |      |          | ⬜   |
| 2    |      |          | ⬜   |
| 3    |      |          | ⬜   |

## 风险与应对



## 资源需求



## 备注


$$, true),

(NULL, '待办清单', '每日/每周任务清单', 'todo',
$$# 待办清单

**日期：** {date}

## 优先级 P0 - 紧急重要

- [ ]
- [ ]

## 优先级 P1 - 重要不紧急

- [ ]
- [ ]

## 优先级 P2 - 紧急不重要

- [ ]
- [ ]

## 优先级 P3 - 不紧急不重要

- [ ]
- [ ]

## 备注


$$, true),

(NULL, '读书笔记', '阅读摘录与心得', 'reading',
$$# 读书笔记

**书名：**
**作者：**
**阅读日期：** {date}

## 核心观点



## 精彩摘录



## 个人思考



## 行动清单

- [ ]
- [ ]

## 相关推荐


$$, true);
