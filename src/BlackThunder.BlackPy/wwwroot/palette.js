"use strict";

(() => {
    const categories = [
        { id: "events", label: "이벤트", color: "#31a354" },
        { id: "motion", label: "움직임", color: "#9954dc" },
        { id: "looks", label: "생김새", color: "#e84d76" },
        { id: "math", label: "계산", color: "#da9a13" },
        { id: "sensing", label: "감지", color: "#119bb8" }
    ];
    const event = (name, argumentsText = "") => `def ${name}(${argumentsText}):\n    pass`;
    const rows = (...codes) => codes.map(code => ({ code, label: code.split("\n")[0] }));
    const cards = [
        { category: "events", title: "시작했을 때", rows: rows(event("시작")) },
        { category: "events", title: "키 · 눌렀을 때 / 누르는 중 / 놓았을 때", rows: rows(
            event("키_클릭", "누른_키"), event("키_클릭_중", "누른_키"), event("키_클릭_끝", "누른_키")) },
        { category: "events", title: "자신 클릭 · 시작 / 누르는 중 / 끝", rows: rows(
            event("자신_클릭"), event("자신_클릭_중"), event("자신_클릭_끝")) },
        { category: "events", title: "방송하기", rows: rows('방송하기("신호")') },
        { category: "events", title: "방송을 받았을 때", rows: rows(event("방송_받기", "신호_이름")) },
        { category: "motion", title: "속도 배율 · 읽기 / 정하기 / 더하기", actor: true,
            rows: rows("속도", "속도 = 1", "속도_변경(1)") },
        { category: "motion", title: "위치 · 읽기 / 정하기", actor: true,
            rows: rows("위치", "위치 = (0, 0)") },
        { category: "motion", title: "방향 · 읽기 / 정하기", actor: true, rows: rows("방향", "방향 = 90") },
        { category: "motion", title: "앞으로", actor: true, rows: rows("앞으로(100)") },
        { category: "motion", title: "왼쪽으로 돌기", actor: true, rows: rows("왼쪽으로돌기(90)") },
        { category: "motion", title: "오른쪽으로 돌기", actor: true, rows: rows("오른쪽으로돌기(90)") },
        { category: "motion", title: "좌표로 바로 가기", actor: true, rows: rows("좌표로(0, 0)") },
        { category: "motion", title: "방향 보기 · 각도 / 위치", actor: true,
            rows: rows("바라보기(90)", "바라보기(100, 0)") },
        { category: "events", title: "기다리기 · 초", rows: rows("기다리기(1)") },
        { category: "looks", title: "말하기", rows: rows('말하기("안녕!")') },
        { category: "looks", title: "배경 바꾸기", background: true, rows: rows('배경 = "city"'),
            note: "plain · city · dance · track · court · forest" },
        { category: "looks", title: "보이기 / 숨기기", actor: true,
            rows: rows("가시성", "가시성 = True", "가시성_설정(False)") },
        { category: "looks", title: "크기 · 읽기 / 정하기 / 더하기", actor: true,
            rows: rows("크기", "크기 = 1", "크기_정하기(2)", "크기_바꾸기(0.5)") },
        { category: "math", title: "x가 2의 배수인가", rows: rows("x % 2 == 0") },
        { category: "math", title: "무작위 정수 · 양끝 포함", rows: rows("랜덤(0, 10)") },
        { category: "math", title: "가로·세로 방향을 각도로", rows: rows("각도로(10, 10)") },
        { category: "sensing", title: "자신의 이름", rows: rows("이름") },
        { category: "sensing", title: "닿음 · 시작 / 닿는 중 / 떨어졌을 때", actor: true, rows: rows(
            event("닿았을_때", "이름_리스트"), event("닿는_중", "이름_리스트"),
            event("닿는_중_종료", "이름_리스트")) },
        { category: "sensing", title: "다른 캐릭터의 위치", rows: rows('위치_구하기("고양이")') },
        { category: "sensing", title: "다른 캐릭터의 방향", rows: rows('방향_구하기("고양이")') }
    ];

    function availableCards(category, isBackground, targetName = "고양이") {
        return cards.filter(card => card.category === category
            && (!card.actor || !isBackground) && (!card.background || isBackground)).map(card => ({
                ...card,
                rows: card.rows.map(row => {
                    const code = row.code.replaceAll('"고양이"', JSON.stringify(targetName));
                    return { code, label: code.split("\n")[0] };
                })
            }));
    }

    async function copyCode(code, clipboard) {
        if (!clipboard?.writeText) throw new Error("복사 기능을 사용할 수 없어요. 코드를 선택해 복사해 주세요.");
        await clipboard.writeText(code);
    }

    function previewScene(project) {
        const sizes = {
            car: [120, 70], cat: [86, 96], rabbit: [82, 100], ball: [64, 64], bat: [120, 70],
            ghost: [72, 84], star: [64, 64], basket: [110, 60], paddle: [140, 24],
            rocket: [90, 64], flag: [50, 80], planet: [90, 90]
        };
        return {
            active: true,
            background: project?.background?.kind || "plain",
            message: "",
            sprites: (project?.actors || []).map((actor, index) => {
                const size = sizes[actor.kind] || sizes.cat;
                return {
                    id: String(index), label: actor.name, kind: actor.kind, x: actor.x ?? 0, y: actor.y ?? 0,
                    heading: actor.heading ?? 0, width: size[0] * (actor.scale ?? 1),
                    height: size[1] * (actor.scale ?? 1), visible: actor.visible !== false, speech: ""
                };
            })
        };
    }

    const api = Object.freeze({ categories, availableCards, copyCode, previewScene });
    if (typeof module !== "undefined" && module.exports) module.exports = api;
    else window.BlackPyPalette = api;
})();
