// 2025/10/04 更新
const defaultData = [
    {
        "id": "46220",
        "bossName": "烏格奴斯",
        "respawnTime": "5",
        "death": "2025-10-31 11:33",
        "deathList": [],
        "DefaultRespawnTime": "2025-10-31T05:00:00.000Z",
        "result": {
            "rebornCount": 3,
            "segments": []
        },
        "respawnCount": 3,
        "emblem": "私服亂源",
        "重生間隔": "08~13",
        "bossDeathDiff": {
            "milliseconds": 23000810,
            "seconds": 23000,
            "minutes": 383,
            "hours": 6
        },
        "已死亡": 418248
    },
    {
        "id": "45456",
        "bossName": "魔法師",
        "respawnTime": "1",
        "death": "2025-10-31 09:33",
        "deathList": [],
        "emblem": "與眾不同",
        "DefaultRespawnTime": "2025-10-31T05:00:00.000Z",
        "respawnCount": 3,
        "result": {
            "rebornCount": 3,
            "segments": []
        },
        "重生間隔": "12~13",
        "bossDeathDiff": {
            "milliseconds": 2120810,
            "seconds": 2120,
            "minutes": 35,
            "hours": 0
        },
        "已死亡": 418249
    },
    {
        "id": "45535",
        "bossName": "曼波兔-墓穴",
        "respawnTime": "1",
        "death": "2025-10-31 10:43",
        "deathList": [],
        "emblem": "羽蝶",
        "DefaultRespawnTime": "2025-10-31T05:00:00.000Z",
        "respawnCount": 3,
        "result": {
            "rebornCount": 3,
            "segments": []
        },
        "重生間隔": "12~13",
        "bossDeathDiff": {
            "milliseconds": 1460811,
            "seconds": 1460,
            "minutes": 24,
            "hours": 0
        },
        "已死亡": 418249
    },
    {
        "id": "45649",
        "bossName": "惡魔",
        "respawnTime": "1",
        "death": "2025-10-31 11:09",
        "deathList": [],
        "emblem": "私服亂源",
        "DefaultRespawnTime": "2025-10-31T05:00:00.000Z",
        "respawnCount": 3,
        "result": {
            "rebornCount": 3,
            "segments": []
        },
        "重生間隔": "12~13",
        "bossDeathDiff": {
            "milliseconds": 740810,
            "seconds": 740,
            "minutes": 12,
            "hours": 0
        },
        "已死亡": 418250
    },
    {
        "id": "45545",
        "bossName": "黑長者",
        "respawnTime": "1",
        "death": "2025-10-31 11:38",
        "deathList": [],
        "emblem": "度估酒鑒",
        "DefaultRespawnTime": "2025-10-31T05:00:00.000Z",
        "respawnCount": 3,
        "result": {
            "rebornCount": 3,
            "segments": []
        },
        "重生間隔": "12~13",
        "bossDeathDiff": {
            "milliseconds": 20811,
            "seconds": 20,
            "minutes": 0,
            "hours": 0
        },
        "已死亡": 418251
    },
    {
        "id": "45640",
        "bossName": "獨角獸",
        "respawnTime": "1",
        "death": "2025-10-31 11:48",
        "deathList": [],
        "emblem": "與眾不同",
        "DefaultRespawnTime": "2025-10-31T05:00:00.000Z",
        "respawnCount": 3,
        "result": {
            "rebornCount": 3,
            "segments": []
        },
        "重生間隔": "12~13",
        "bossDeathDiff": {
            "milliseconds": 2480810,
            "seconds": 2480,
            "minutes": 41,
            "hours": 0
        },
        "已死亡": 418251
    },
    {
        "id": "45963",
        "bossName": "副神官‧卡山德拉",
        "respawnTime": "7",
        "death": "2025-10-30 21:00",
        "deathList": [],
        "emblem": "休閒養老",
        "DefaultRespawnTime": "2025-10-31T08:00:00.000Z",
        "respawnCount": 3,
        "result": {
            "rebornCount": 3,
            "segments": []
        },
        "重生間隔": "09~16",
        "bossDeathDiff": {
            "milliseconds": 23000812,
            "seconds": 23000,
            "minutes": 383,
            "hours": 6
        },
        "已死亡": 418251
    },
    {
        "id": "91516",
        "bossName": "法利昂",
        "respawnTime": "24",
        "death": "2025-10-30 23:40",
        "deathList": [],
        "DefaultRespawnTime": "2025-10-31T07:00:00.000Z",
        "result": {
            "rebornCount": 3,
            "segments": []
        },
        "respawnCount": 3,
        "emblem": "私服亂源",
        "重生間隔": "12~15",
        "bossDeathDiff": {
            "milliseconds": 23000812,
            "seconds": 23000,
            "minutes": 383,
            "hours": 6
        },
        "已死亡": 418254
    },
    {
        "id": "46291",
        "bossName": "須曼",
        "respawnTime": "4",
        "death": "2025-10-30 19:37",
        "deathList": [],
        "emblem": "{沒有}",
        "DefaultRespawnTime": "2025-10-31T08:00:00.000Z",
        "respawnCount": 3,
        "result": {
            "rebornCount": 3,
            "segments": []
        },
        "重生間隔": "12~16",
        "bossDeathDiff": {
            "milliseconds": 81260811,
            "seconds": 81260,
            "minutes": 1354,
            "hours": 22
        },
        "已死亡": 418257
    },
    {
        "id": "45584",
        "bossName": "巨大牛人",
        "respawnTime": "4",
        "death": "2025-10-31 05:35",
        "deathList": [],
        "emblem": "與人無患",
        "DefaultRespawnTime": "2025-10-31T08:00:00.000Z",
        "respawnCount": 3,
        "result": {
            "rebornCount": 3,
            "segments": []
        },
        "重生間隔": "12~16",
        "bossDeathDiff": {
            "milliseconds": 57620811,
            "seconds": 57620,
            "minutes": 960,
            "hours": 16
        },
        "已死亡": 418257
    },
    {
        "id": "46141",
        "bossName": "冰之女王",
        "respawnTime": "5",
        "death": "2025-10-30 22:17",
        "deathList": [],
        "emblem": "休閒養老",
        "DefaultRespawnTime": "2025-10-31T05:00:00.000Z",
        "respawnCount": 2,
        "result": {
            "rebornCount": 2,
            "segments": []
        },
        "重生間隔": "08~13",
        "bossDeathDiff": {
            "milliseconds": 23000810,
            "seconds": 23000,
            "minutes": 383,
            "hours": 6
        },
        "已死亡": 418257
    },
    {
        "id": "81082",
        "bossName": "火焰之影",
        "respawnTime": "7",
        "death": "2025-10-31 09:05",
        "deathList": [],
        "DefaultRespawnTime": "2025-10-31T08:00:00.000Z",
        "result": {
            "rebornCount": 2,
            "segments": []
        },
        "respawnCount": 2,
        "emblem": "私服亂源",
        "重生間隔": "09~16",
        "bossDeathDiff": {
            "milliseconds": 64280811,
            "seconds": 64280,
            "minutes": 1071,
            "hours": 17
        },
        "已死亡": 418257
    },
    {
        "id": "91202",
        "bossName": "安塔瑞斯",
        "respawnTime": "24",
        "death": "2025-10-30 23:33",
        "deathList": [],
        "DefaultRespawnTime": "2025-10-31T07:00:00.000Z",
        "result": {
            "rebornCount": 2,
            "segments": []
        },
        "respawnCount": 2,
        "emblem": "私服亂源",
        "重生間隔": "12~15",
        "bossDeathDiff": {
            "milliseconds": 23000812,
            "seconds": 23000,
            "minutes": 383,
            "hours": 6
        },
        "已死亡": 418257
    },
    {
        "id": "45546",
        "bossName": "變形怪首領",
        "respawnTime": "4",
        "death": "2025-10-31 11:46",
        "deathList": [],
        "emblem": "私服亂源",
        "DefaultRespawnTime": "2025-10-31T08:00:00.000Z",
        "respawnCount": 2,
        "result": {
            "rebornCount": 2,
            "segments": []
        },
        "重生間隔": "12~16",
        "bossDeathDiff": {
            "milliseconds": 23000811,
            "seconds": 23000,
            "minutes": 383,
            "hours": 6
        },
        "已死亡": 418258
    },
    {
        "id": "45673",
        "bossName": "邪惡的鐮刀死神",
        "respawnTime": "5",
        "death": "2025-10-31 05:41",
        "deathList": [],
        "emblem": "休閒養老",
        "DefaultRespawnTime": "2025-10-31T05:00:00.000Z",
        "respawnCount": 1,
        "result": {
            "rebornCount": 1,
            "segments": []
        },
        "重生間隔": "08~13",
        "bossDeathDiff": {
            "milliseconds": 23000812,
            "seconds": 23000,
            "minutes": 383,
            "hours": 6
        },
        "已死亡": 418258
    },
    {
        "id": "45606",
        "bossName": "恐怖的吸血鬼",
        "respawnTime": "5",
        "death": "2025-10-31 05:43",
        "deathList": [],
        "emblem": "私服亂源",
        "DefaultRespawnTime": "2025-10-31T05:00:00.000Z",
        "respawnCount": 1,
        "result": {
            "rebornCount": 1,
            "segments": []
        },
        "重生間隔": "08~13",
        "bossDeathDiff": {
            "milliseconds": 23000812,
            "seconds": 23000,
            "minutes": 383,
            "hours": 6
        },
        "已死亡": 418258
    },
    {
        "id": "99513",
        "bossName": "Kireg",
        "respawnTime": "5",
        "death": "2025-10-31 06:13",
        "deathList": [],
        "emblem": "與人無患",
        "DefaultRespawnTime": "2025-10-31T05:00:00.000Z",
        "respawnCount": 1,
        "result": {
            "rebornCount": 1,
            "segments": []
        },
        "重生間隔": "08~13",
        "bossDeathDiff": {
            "milliseconds": 23000812,
            "seconds": 23000,
            "minutes": 383,
            "hours": 6
        },
        "已死亡": 418258
    },
    {
        "id": "99514",
        "bossName": "Revenant",
        "respawnTime": "5",
        "death": "2025-10-31 07:02",
        "deathList": [],
        "emblem": "與人無患",
        "DefaultRespawnTime": "2025-10-31T05:00:00.000Z",
        "respawnCount": 1,
        "result": {
            "rebornCount": 1,
            "segments": []
        },
        "重生間隔": "08~13",
        "bossDeathDiff": {
            "milliseconds": 105740810,
            "seconds": 105740,
            "minutes": 1762,
            "hours": 29
        },
        "已死亡": 418258
    },
    {
        "id": "45672",
        "bossName": "不滅的巫妖",
        "respawnTime": "5",
        "death": "2025-10-31 07:03",
        "deathList": [],
        "emblem": "Il一雲門集團一II",
        "DefaultRespawnTime": "2025-10-31T05:00:00.000Z",
        "respawnCount": 1,
        "result": {
            "rebornCount": 1,
            "segments": []
        },
        "重生間隔": "08~13",
        "bossDeathDiff": {
            "milliseconds": 23000812,
            "seconds": 23000,
            "minutes": 383,
            "hours": 6
        },
        "已死亡": 418258
    },
    {
        "id": "45513",
        "bossName": "扭曲的潔尼斯女王",
        "respawnTime": "5",
        "death": "2025-10-31 07:16",
        "deathList": [],
        "emblem": "Haven",
        "DefaultRespawnTime": "2025-10-31T05:00:00.000Z",
        "respawnCount": 1,
        "result": {
            "rebornCount": 1,
            "segments": []
        },
        "重生間隔": "08~13",
        "bossDeathDiff": {
            "milliseconds": 23000810,
            "seconds": 23000,
            "minutes": 383,
            "hours": 6
        },
        "已死亡": 418258
    },
    {
        "id": "46142",
        "bossName": "冰魔",
        "respawnTime": "5",
        "death": "2025-10-31 07:59",
        "deathList": [],
        "emblem": "{沒有}",
        "DefaultRespawnTime": "2025-10-31T05:00:00.000Z",
        "respawnCount": 1,
        "result": {
            "rebornCount": 1,
            "segments": []
        },
        "重生間隔": "08~13",
        "bossDeathDiff": {
            "milliseconds": 23000810,
            "seconds": 23000,
            "minutes": 383,
            "hours": 6
        },
        "已死亡": 418258
    },
    {
        "id": "45618",
        "bossName": "闇黑的騎士范德",
        "respawnTime": "5",
        "death": "2025-10-31 08:24",
        "deathList": [],
        "emblem": "Il一雲門集團一II",
        "DefaultRespawnTime": "2025-10-31T05:00:00.000Z",
        "respawnCount": 1,
        "result": {
            "rebornCount": 1,
            "segments": []
        },
        "重生間隔": "08~13",
        "bossDeathDiff": {
            "milliseconds": 23000810,
            "seconds": 23000,
            "minutes": 383,
            "hours": 6
        },
        "已死亡": 418258
    },
    {
        "id": "45653",
        "bossName": "不死的木乃伊王",
        "respawnTime": "5",
        "death": "2025-10-31 08:28",
        "deathList": [],
        "emblem": "Il一雲門集團一II",
        "DefaultRespawnTime": "2025-10-31T05:00:00.000Z",
        "respawnCount": 1,
        "result": {
            "rebornCount": 1,
            "segments": []
        },
        "重生間隔": "08~13",
        "bossDeathDiff": {
            "milliseconds": 23000810,
            "seconds": 23000,
            "minutes": 383,
            "hours": 6
        },
        "已死亡": 418258
    },
    {
        "id": "45652",
        "bossName": "地獄的黑豹",
        "respawnTime": "5",
        "death": "2025-10-31 09:01",
        "deathList": [],
        "emblem": "Il一雲門集團一II",
        "DefaultRespawnTime": "2025-10-31T05:00:00.000Z",
        "respawnCount": 1,
        "result": {
            "rebornCount": 1,
            "segments": []
        },
        "重生間隔": "08~13",
        "bossDeathDiff": {
            "milliseconds": 23000810,
            "seconds": 23000,
            "minutes": 383,
            "hours": 6
        },
        "已死亡": 418258
    },
    {
        "id": "45534",
        "bossName": "曼波兔-島",
        "respawnTime": "1",
        "death": "2025-10-31 11:33",
        "deathList": [],
        "emblem": "私服亂源",
        "DefaultRespawnTime": "2025-10-31T05:00:00.000Z",
        "respawnCount": 1,
        "result": {
            "rebornCount": 1,
            "segments": []
        },
        "重生間隔": "12~13",
        "bossDeathDiff": {
            "milliseconds": 1640811,
            "seconds": 1640,
            "minutes": 27,
            "hours": 0
        },
        "已死亡": 418258
    },
    {
        "id": "45488",
        "bossName": "四色",
        "respawnTime": "1",
        "death": "2025-10-31 11:38",
        "deathList": [],
        "emblem": "與世無爭",
        "DefaultRespawnTime": "2025-10-31T05:00:00.000Z",
        "respawnCount": 1,
        "result": {
            "rebornCount": 1,
            "segments": []
        },
        "重生間隔": "12~13",
        "bossDeathDiff": {
            "milliseconds": 2660811,
            "seconds": 2660,
            "minutes": 44,
            "hours": 0
        },
        "已死亡": 418258
    },
    {
        "id": "45962",
        "bossName": "長老．巴陸德",
        "respawnTime": "7",
        "death": "2025-10-31 05:23",
        "deathList": [],
        "emblem": "私服亂源",
        "DefaultRespawnTime": "2025-10-31T08:00:00.000Z",
        "respawnCount": 1,
        "result": {
            "rebornCount": 1,
            "segments": []
        },
        "重生間隔": "09~16",
        "bossDeathDiff": {
            "milliseconds": 53960811,
            "seconds": 53960,
            "minutes": 899,
            "hours": 14
        },
        "已死亡": 418258
    },
    {
        "id": "45863",
        "bossName": "法令軍王蕾雅",
        "respawnTime": "7",
        "death": "2025-10-31 05:52",
        "deathList": [],
        "emblem": "休閒養老",
        "DefaultRespawnTime": "2025-10-31T08:00:00.000Z",
        "respawnCount": 1,
        "result": {
            "rebornCount": 1,
            "segments": []
        },
        "重生間隔": "09~16",
        "bossDeathDiff": {
            "milliseconds": 23000811,
            "seconds": 23000,
            "minutes": 383,
            "hours": 6
        },
        "已死亡": 418258
    },
    {
        "id": "99053",
        "bossName": "奈克偌斯",
        "respawnTime": "7",
        "death": "2025-10-31 06:03",
        "deathList": [],
        "emblem": "{沒有}",
        "DefaultRespawnTime": "2025-10-31T08:00:00.000Z",
        "respawnCount": 1,
        "result": {
            "rebornCount": 1,
            "segments": []
        },
        "重生間隔": "09~16",
        "bossDeathDiff": {
            "milliseconds": 23000811,
            "seconds": 23000,
            "minutes": 383,
            "hours": 6
        },
        "已死亡": 418258
    },
    {
        "id": "45801",
        "bossName": "瑪依奴夏門的鑽石高崙",
        "respawnTime": "7",
        "death": "2025-10-31 06:09",
        "deathList": [],
        "emblem": "羽蝶",
        "DefaultRespawnTime": "2025-10-31T08:00:00.000Z",
        "respawnCount": 1,
        "result": {
            "rebornCount": 1,
            "segments": []
        },
        "重生間隔": "09~16",
        "bossDeathDiff": {
            "milliseconds": 23000811,
            "seconds": 23000,
            "minutes": 383,
            "hours": 6
        },
        "已死亡": 418258
    },
    {
        "id": "45617",
        "bossName": "不死鳥",
        "respawnTime": "7",
        "death": "2025-10-31 06:10",
        "deathList": [],
        "emblem": "與世無爭",
        "DefaultRespawnTime": "2025-10-31T08:00:00.000Z",
        "respawnCount": 1,
        "result": {
            "rebornCount": 1,
            "segments": []
        },
        "重生間隔": "09~16",
        "bossDeathDiff": {
            "milliseconds": 48980811,
            "seconds": 48980,
            "minutes": 816,
            "hours": 13
        },
        "已死亡": 418258
    },
    {
        "id": "45674",
        "bossName": "死亡",
        "respawnTime": "7",
        "death": "2025-10-31 06:14",
        "deathList": [],
        "emblem": "Il一雲門集團一II",
        "DefaultRespawnTime": "2025-10-31T08:00:00.000Z",
        "respawnCount": 1,
        "result": {
            "rebornCount": 1,
            "segments": []
        },
        "重生間隔": "09~16",
        "bossDeathDiff": {
            "milliseconds": 23000811,
            "seconds": 23000,
            "minutes": 383,
            "hours": 6
        },
        "已死亡": 418258
    },
    {
        "id": "45753",
        "bossName": "炎魔",
        "respawnTime": "7",
        "death": "2025-10-31 06:23",
        "deathList": [],
        "emblem": "Il一雲門集團一II",
        "DefaultRespawnTime": "2025-10-31T08:00:00.000Z",
        "respawnCount": 1,
        "result": {
            "rebornCount": 1,
            "segments": []
        },
        "重生間隔": "09~16",
        "bossDeathDiff": {
            "milliseconds": 132380811,
            "seconds": 132380,
            "minutes": 2206,
            "hours": 36
        },
        "已死亡": 418258
    },
    {
        "id": "45958",
        "bossName": "長老．安迪斯",
        "respawnTime": "7",
        "death": "2025-10-31 06:47",
        "deathList": [],
        "emblem": "Il一雲門集團一II",
        "DefaultRespawnTime": "2025-10-31T08:00:00.000Z",
        "respawnCount": 1,
        "result": {
            "rebornCount": 1,
            "segments": []
        },
        "重生間隔": "09~16",
        "bossDeathDiff": {
            "milliseconds": 23000811,
            "seconds": 23000,
            "minutes": 383,
            "hours": 6
        },
        "已死亡": 418258
    },
    {
        "id": "45829",
        "bossName": "巴貝多",
        "respawnTime": "7",
        "death": "2025-10-31 06:47",
        "deathList": [],
        "emblem": "羽蝶",
        "DefaultRespawnTime": "2025-10-31T08:00:00.000Z",
        "respawnCount": 1,
        "result": {
            "rebornCount": 1,
            "segments": []
        },
        "重生間隔": "09~16",
        "bossDeathDiff": {
            "milliseconds": 23000812,
            "seconds": 23000,
            "minutes": 383,
            "hours": 6
        },
        "已死亡": 418258
    },
    {
        "id": "45685",
        "bossName": "墮落",
        "respawnTime": "7",
        "death": "2025-10-31 06:59",
        "deathList": [],
        "emblem": "私服亂源",
        "DefaultRespawnTime": "2025-10-31T08:00:00.000Z",
        "respawnCount": 1,
        "result": {
            "rebornCount": 1,
            "segments": []
        },
        "重生間隔": "09~16",
        "bossDeathDiff": {
            "milliseconds": 23000811,
            "seconds": 23000,
            "minutes": 383,
            "hours": 6
        },
        "已死亡": 418258
    },
    {
        "id": "45955",
        "bossName": "長老．琪娜",
        "respawnTime": "7",
        "death": "2025-10-31 07:44",
        "deathList": [],
        "emblem": "私服亂源",
        "DefaultRespawnTime": "2025-10-31T08:00:00.000Z",
        "respawnCount": 1,
        "result": {
            "rebornCount": 1,
            "segments": []
        },
        "重生間隔": "09~16",
        "bossDeathDiff": {
            "milliseconds": 23000811,
            "seconds": 23000,
            "minutes": 383,
            "hours": 6
        },
        "已死亡": 418259
    },
    {
        "id": "45601",
        "bossName": "死亡騎士",
        "respawnTime": "7",
        "death": "2025-10-31 07:47",
        "deathList": [],
        "emblem": "羽蝶",
        "DefaultRespawnTime": "2025-10-31T08:00:00.000Z",
        "respawnCount": 1,
        "result": {
            "rebornCount": 1,
            "segments": []
        },
        "重生間隔": "09~16",
        "bossDeathDiff": {
            "milliseconds": 23000811,
            "seconds": 23000,
            "minutes": 383,
            "hours": 6
        },
        "已死亡": 418259
    },
    {
        "id": "45956",
        "bossName": "長老．巴塔斯",
        "respawnTime": "7",
        "death": "2025-10-31 08:02",
        "deathList": [],
        "emblem": "私服亂源",
        "DefaultRespawnTime": "2025-10-31T08:00:00.000Z",
        "respawnCount": 1,
        "result": {
            "rebornCount": 1,
            "segments": []
        },
        "重生間隔": "09~16",
        "bossDeathDiff": {
            "milliseconds": 23000811,
            "seconds": 23000,
            "minutes": 383,
            "hours": 6
        },
        "已死亡": 418259
    },
    {
        "id": "45614",
        "bossName": "巨蟻女皇",
        "respawnTime": "7",
        "death": "2025-10-31 08:04",
        "deathList": [],
        "emblem": "{沒有}",
        "DefaultRespawnTime": "2025-10-31T08:00:00.000Z",
        "respawnCount": 1,
        "result": {
            "rebornCount": 1,
            "segments": []
        },
        "重生間隔": "09~16",
        "bossDeathDiff": {
            "milliseconds": 23000811,
            "seconds": 23000,
            "minutes": 383,
            "hours": 6
        },
        "已死亡": 418259
    },
    {
        "id": "45959",
        "bossName": "長老．艾迪爾",
        "respawnTime": "7",
        "death": "2025-10-31 08:07",
        "deathList": [],
        "emblem": "私服亂源",
        "DefaultRespawnTime": "2025-10-31T08:00:00.000Z",
        "respawnCount": 1,
        "result": {
            "rebornCount": 1,
            "segments": []
        },
        "重生間隔": "09~16",
        "bossDeathDiff": {
            "milliseconds": 23000812,
            "seconds": 23000,
            "minutes": 383,
            "hours": 6
        },
        "已死亡": 418259
    },
    {
        "id": "45960",
        "bossName": "長老．泰瑪斯",
        "respawnTime": "7",
        "death": "2025-10-31 08:21",
        "deathList": [],
        "emblem": "私服亂源",
        "DefaultRespawnTime": "2025-10-31T08:00:00.000Z",
        "respawnCount": 1,
        "result": {
            "rebornCount": 1,
            "segments": []
        },
        "重生間隔": "09~16",
        "bossDeathDiff": {
            "milliseconds": 23000812,
            "seconds": 23000,
            "minutes": 383,
            "hours": 6
        },
        "已死亡": 418259
    },
    {
        "id": "45625",
        "bossName": "混沌",
        "respawnTime": "7",
        "death": "2025-10-31 08:26",
        "deathList": [],
        "emblem": "私服亂源",
        "DefaultRespawnTime": "2025-10-31T08:00:00.000Z",
        "respawnCount": 1,
        "result": {
            "rebornCount": 1,
            "segments": []
        },
        "重生間隔": "09~16",
        "bossDeathDiff": {
            "milliseconds": 23000811,
            "seconds": 23000,
            "minutes": 383,
            "hours": 6
        },
        "已死亡": 418259
    },
    {
        "id": "99065",
        "bossName": "阿勒尼亞",
        "respawnTime": "7",
        "death": "2025-10-31 09:43",
        "deathList": [],
        "emblem": "Il一雲門集團一II",
        "DefaultRespawnTime": "2025-10-31T08:00:00.000Z",
        "respawnCount": 1,
        "result": {
            "rebornCount": 1,
            "segments": []
        },
        "重生間隔": "09~16",
        "bossDeathDiff": {
            "milliseconds": 23000811,
            "seconds": 23000,
            "minutes": 383,
            "hours": 6
        },
        "已死亡": 418259
    },
    {
        "id": "99059",
        "bossName": "烏若庫斯",
        "respawnTime": "7",
        "death": "2025-10-31 10:37",
        "deathList": [],
        "emblem": "跳脫舒適圈",
        "DefaultRespawnTime": "2025-10-31T08:00:00.000Z",
        "respawnCount": 1,
        "result": {
            "rebornCount": 1,
            "segments": []
        },
        "重生間隔": "09~16",
        "bossDeathDiff": {
            "milliseconds": 23000812,
            "seconds": 23000,
            "minutes": 383,
            "hours": 6
        },
        "已死亡": 418259
    },
    {
        "id": "91605",
        "bossName": "林德拜爾",
        "respawnTime": "24",
        "death": "2025-10-30 23:48",
        "deathList": [],
        "DefaultRespawnTime": "2025-10-31T07:00:00.000Z",
        "result": {
            "rebornCount": 1,
            "segments": []
        },
        "respawnCount": 1,
        "emblem": "私服亂源",
        "重生間隔": "12~15",
        "bossDeathDiff": {
            "milliseconds": 23000812,
            "seconds": 23000,
            "minutes": 383,
            "hours": 6
        },
        "已死亡": 418259
    },
    {
        "id": "45600",
        "bossName": "克特",
        "respawnTime": "4",
        "death": "2025-10-31 08:12",
        "deathList": [],
        "emblem": "Il一雲門集團一II",
        "DefaultRespawnTime": "2025-10-31T08:00:00.000Z",
        "respawnCount": 1,
        "result": {
            "rebornCount": 1,
            "segments": []
        },
        "重生間隔": "12~16",
        "bossDeathDiff": {
            "milliseconds": 23000812,
            "seconds": 23000,
            "minutes": 383,
            "hours": 6
        },
        "已死亡": 418259
    },
    {
        "id": "45680",
        "bossName": "反王肯恩",
        "respawnTime": "4",
        "death": "2025-10-31 10:33",
        "deathList": [],
        "emblem": "Il一雲門集團一II",
        "DefaultRespawnTime": "2025-10-31T08:00:00.000Z",
        "respawnCount": 1,
        "result": {
            "rebornCount": 1,
            "segments": []
        },
        "重生間隔": "12~16",
        "bossDeathDiff": {
            "milliseconds": 23000812,
            "seconds": 23000,
            "minutes": 383,
            "hours": 6
        },
        "已死亡": 418259
    },
    {
        "id": "45678",
        "bossName": "賽尼斯",
        "respawnTime": "4",
        "death": "2025-10-31 10:33",
        "deathList": [],
        "emblem": "Il一雲門集團一II",
        "DefaultRespawnTime": "2025-10-31T08:00:00.000Z",
        "respawnCount": 1,
        "result": {
            "rebornCount": 1,
            "segments": []
        },
        "重生間隔": "12~16",
        "bossDeathDiff": {
            "milliseconds": 23000812,
            "seconds": 23000,
            "minutes": 383,
            "hours": 6
        },
        "已死亡": 418259
    },
    {
        "id": "45610",
        "bossName": "古代巨人",
        "respawnTime": "4",
        "death": "2025-10-31 11:45",
        "deathList": [],
        "emblem": "私服亂源",
        "DefaultRespawnTime": "2025-10-31T08:00:00.000Z",
        "respawnCount": 1,
        "result": {
            "rebornCount": 1,
            "segments": []
        },
        "重生間隔": "12~16",
        "bossDeathDiff": {
            "milliseconds": 23000811,
            "seconds": 23000,
            "minutes": 383,
            "hours": 6
        },
        "已死亡": 418259
    },
    {
        "id": "45957",
        "bossName": "長老．巴洛斯",
        "respawnTime": "7",
        "death": "2025-10-31 06:44",
        "deathList": [],
        "emblem": "Il一雲門集團一II",
        "DefaultRespawnTime": "2025-10-31T08:00:00.000Z",
        "respawnCount": 0,
        "result": {
            "rebornCount": 0,
            "segments": []
        },
        "重生間隔": "09~16",
        "bossDeathDiff": {
            "milliseconds": 23000811,
            "seconds": 23000,
            "minutes": 383,
            "hours": 6
        },
        "已死亡": 418259
    },
    {
        "id": "99087",
        "bossName": "大腳的瑪幽",
        "respawnTime": "5",
        "death": "2025-10-31 08:09",
        "deathList": [],
        "emblem": "私服亂源",
        "DefaultRespawnTime": "2025-10-31T05:00:00.000Z",
        "respawnCount": 0,
        "result": {
            "rebornCount": 0,
            "segments": []
        },
        "重生間隔": "08~13",
        "bossDeathDiff": {
            "milliseconds": 23000810,
            "seconds": 23000,
            "minutes": 383,
            "hours": 6
        },
        "已死亡": 418259
    },
    {
        "id": "45650",
        "bossName": "死亡的殭屍王",
        "respawnTime": "5",
        "death": "2025-10-31 08:49",
        "deathList": [],
        "emblem": "私服亂源",
        "DefaultRespawnTime": "2025-10-31T05:00:00.000Z",
        "respawnCount": 0,
        "result": {
            "rebornCount": 0,
            "segments": []
        },
        "重生間隔": "08~13",
        "bossDeathDiff": {
            "milliseconds": 23000810,
            "seconds": 23000,
            "minutes": 383,
            "hours": 6
        },
        "已死亡": 418259
    },
    {
        "id": "45583",
        "bossName": "巴列斯",
        "respawnTime": "5",
        "death": "2025-10-31 09:41",
        "deathList": [],
        "emblem": "Il一雲門集團一II",
        "DefaultRespawnTime": "2025-10-31T05:00:00.000Z",
        "respawnCount": 0,
        "result": {
            "rebornCount": 0,
            "segments": []
        },
        "重生間隔": "08~13",
        "bossDeathDiff": {
            "milliseconds": 23000812,
            "seconds": 23000,
            "minutes": 383,
            "hours": 6
        },
        "已死亡": 418259
    },
    {
        "id": "45654",
        "bossName": "冷酷的艾莉絲",
        "respawnTime": "5",
        "death": "2025-10-31 10:06",
        "deathList": [],
        "emblem": "不要申請",
        "DefaultRespawnTime": "2025-10-31T05:00:00.000Z",
        "respawnCount": 0,
        "result": {
            "rebornCount": 0,
            "segments": []
        },
        "重生間隔": "08~13",
        "bossDeathDiff": {
            "milliseconds": 23000810,
            "seconds": 23000,
            "minutes": 383,
            "hours": 6
        },
        "已死亡": 418259
    },
    {
        "id": "45961",
        "bossName": "長老．拉曼斯",
        "respawnTime": "7",
        "death": "2025-10-31 10:34",
        "deathList": [],
        "emblem": "私服亂源",
        "DefaultRespawnTime": "2025-10-31T08:00:00.000Z",
        "respawnCount": 0,
        "result": {
            "rebornCount": 0,
            "segments": []
        },
        "重生間隔": "09~16",
        "bossDeathDiff": {
            "milliseconds": 23000811,
            "seconds": 23000,
            "minutes": 383,
            "hours": 6
        },
        "已死亡": 418259
    },
    {
        "id": "99037",
        "bossName": "力卡溫",
        "respawnTime": "7",
        "death": "2025-10-31 11:23",
        "deathList": [],
        "emblem": "{沒有}",
        "DefaultRespawnTime": "2025-10-31T08:00:00.000Z",
        "respawnCount": 0,
        "result": {
            "rebornCount": 0,
            "segments": []
        },
        "重生間隔": "09~16",
        "bossDeathDiff": {
            "milliseconds": 23000811,
            "seconds": 23000,
            "minutes": 383,
            "hours": 6
        },
        "已死亡": 418259
    },
    {
        "id": "45573",
        "bossName": "巴風特",
        "respawnTime": "5",
        "death": "2025-10-31 11:31",
        "deathList": [],
        "emblem": "羽蝶",
        "DefaultRespawnTime": "2025-10-31T05:00:00.000Z",
        "respawnCount": 0,
        "result": {
            "rebornCount": 0,
            "segments": []
        },
        "重生間隔": "08~13",
        "bossDeathDiff": {
            "milliseconds": 23000812,
            "seconds": 23000,
            "minutes": 383,
            "hours": 6
        },
        "已死亡": 418259
    },
    {
        "id": "99086",
        "bossName": "狂風的夏斯奇-紅",
        "respawnTime": "5",
        "death": "2025-10-31 11:41",
        "deathList": [],
        "emblem": "度估酒鑒",
        "DefaultRespawnTime": "2025-10-31T05:00:00.000Z",
        "respawnCount": 0,
        "result": {
            "rebornCount": 0,
            "segments": []
        },
        "重生間隔": "08~13",
        "bossDeathDiff": {
            "milliseconds": 23000810,
            "seconds": 23000,
            "minutes": 383,
            "hours": 6
        },
        "已死亡": 418259
    },
    {
        "id": "99085",
        "bossName": "狂風的夏斯奇-綠",
        "respawnTime": "5",
        "death": "2025-10-31 11:43",
        "deathList": [],
        "emblem": "度估酒鑒",
        "DefaultRespawnTime": "2025-10-31T05:00:00.000Z",
        "respawnCount": 0,
        "result": {
            "rebornCount": 0,
            "segments": []
        },
        "重生間隔": "08~13",
        "bossDeathDiff": {
            "milliseconds": 23000810,
            "seconds": 23000,
            "minutes": 383,
            "hours": 6
        },
        "已死亡": 418259
    },
    {
        "id": "99047",
        "bossName": "凱巴雷",
        "respawnTime": "7",
        "death": "2025-10-31 11:46",
        "deathList": [],
        "emblem": "猛鬼宿舍",
        "DefaultRespawnTime": "2025-10-31T08:00:00.000Z",
        "respawnCount": 0,
        "result": {
            "rebornCount": 0,
            "segments": []
        },
        "重生間隔": "09~16",
        "bossDeathDiff": {
            "milliseconds": 23000812,
            "seconds": 23000,
            "minutes": 383,
            "hours": 6
        },
        "已死亡": 418259
    },
    {
        "id": "45547",
        "bossName": "不幸的幻象眼魔",
        "respawnTime": "5",
        "death": "2025-10-31 11:41",
        "deathList": [],
        "emblem": "私服亂源",
        "DefaultRespawnTime": "2025-10-31T05:00:00.000Z",
        "respawnCount": -1,
        "result": {
            "rebornCount": -1,
            "segments": []
        },
        "重生間隔": "08~13",
        "bossDeathDiff": {
            "milliseconds": 23000812,
            "seconds": 23000,
            "minutes": 383,
            "hours": 6
        },
        "已死亡": 418259
    }
]