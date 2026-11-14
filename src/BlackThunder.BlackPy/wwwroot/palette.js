"use strict";

(() => {
    const categories = [
        { id: "events", label: "이벤트", color: "#31a354" },
        { id: "motion", label: "움직임", color: "#9954dc" },
        { id: "physics", label: "물리", color: "#4079ed" },
        { id: "looks", label: "생김새", color: "#e84d76" },
        { id: "math", label: "계산", color: "#da9a13" },
        { id: "sensing", label: "주변", color: "#119bb8" }
    ];
    const event = (name, argumentsText = "") => `def ${name}(${argumentsText}):\n    pass`;
    const value = code => ({ code, kind: "value" });
    const rows = (...codes) => codes.map(item => {
        const row = typeof item === "string"
            ? { code: item, kind: item.startsWith("def ") ? "event" : "command" } : item;
        return { ...row, label: row.code.split("\n")[0] };
    });
    const cards = [
        { category: "events", title: "시작했을 때", rows: rows(event("시작")) },
        { category: "events", title: "키 · 눌렀을 때 / 누르는 중 / 놓았을 때", rows: rows(
            event("키_누름", "누른_키"), event("키_누름_중", "누른_키"), event("키_누름_끝", "누른_키")) },
        { category: "events", title: "자신 클릭 · 시작 / 누르는 중 / 끝", rows: rows(
            event("자신_클릭"), event("자신_클릭_중"), event("자신_클릭_끝")) },
        { category: "events", title: "방송하기", sectionStart: true, rows: rows('방송하기("신호")') },
        { category: "events", title: "방송을 받았을 때", rows: rows(event("방송_받기", "신호_이름")) },
        { category: "motion", title: "속도 배율 · 읽기 / 더하기", actor: true,
            rows: rows(value("속도"), "속도_변경(1)") },
        { category: "motion", title: "위치", actor: true, sectionStart: true, rows: rows(value("위치")) },
        { category: "motion", title: "방향", actor: true, rows: rows(value("방향")) },
        { category: "motion", title: "앞으로", actor: true, rows: rows("앞으로(100)"),
            note: "‘중’ 이벤트에서는 속도예요. 앞으로(1)은 1초에 200만큼 가요." },
        { category: "motion", title: "왼쪽으로 돌기", actor: true, rows: rows("왼쪽_돌기(90)") },
        { category: "motion", title: "오른쪽으로 돌기", actor: true, rows: rows("오른쪽_돌기(90)") },
        { category: "motion", title: "뒤집기", actor: true, rows: rows('뒤집기("가로")') },
        { category: "motion", title: "좌표로 바로 가기", actor: true, rows: rows("좌표로(0, 0)") },
        { category: "motion", title: "방향 보기 · 각도", actor: true, rows: rows("바라보기(0)") },
        { category: "motion", title: "방향 보기 · 위치", actor: true, rows: rows("바라보기(10, 0)") },
        { category: "motion", title: "기다리기 · 초", sectionStart: true,
            rows: rows("기다리기(1)") },
        { category: "physics", title: "물리 객체", actor: true,
            rows: rows(value("물리"), '물리_설정("물리")', '물리_설정("충돌만")', '물리_설정("충돌만", 트리거=True)'),
            note: "‘없음’, ‘충돌만’, ‘물리’ 중 하나를 선택해요. ‘물리’에서는 중력이 작용해요." },
        { category: "physics", title: "무게", actor: true, sectionStart: true,
            rows: rows(value("무게"), "무게_설정(10)") },
        { category: "physics", title: "힘", actor: true, rows: rows("힘_작용(90, 10)", "정지()"),
            note: "각도 방향으로 한 번 밀어요. 정지는 현재 물리 속도를 0으로 만들며, 중력은 계속 작용해요." },
        { category: "physics", title: "충돌 · 시작 / 닿는 중 / 떨어졌을 때", actor: true, sectionStart: true,
            rows: rows(value("닿은_객체_리스트"), event("닿았을_때", "이름_리스트"),
                event("닿는_중", "이름_리스트"), event("닿는_중_종료", "이름_리스트")) },
        { category: "looks", title: "말하기", rows: rows('말하기("안녕!")') },
        { category: "looks", title: "보임 / 숨김 상태", actor: true, sectionStart: true,
            rows: rows(value("가시성"), "가시성_설정(True)") },
        { category: "looks", title: "크기", actor: true, sectionStart: true, rows: rows(value("크기")) },
        { category: "looks", title: "크기 바꾸기 · 현재 값에 더하기", actor: true, rows: rows("크기_바꾸기(2)") },
        { category: "looks", title: "크기 정하기 · 절대 배율", actor: true, rows: rows("크기_정하기(1)") },
        { category: "math", title: "x가 2의 배수인가", rows: rows(value("x % 2 == 0")) },
        { category: "math", title: "무작위 정수 · 양끝 포함", rows: rows(value("랜덤(0, 10)")) },
        { category: "math", title: "가로·세로 방향을 각도로", rows: rows(value("각도로(10, 10)")) },
        { category: "sensing", title: "이름", rows: rows(value("이름")) },
        { category: "sensing", title: "이름 정하기", actor: true, rows: rows('이름_정하기("새이름")') },
        { category: "sensing", title: "다른 캐릭터의 위치", rows: rows(value('위치_구하기("고양이")')) },
        { category: "sensing", title: "다른 캐릭터의 방향", rows: rows(value('방향_구하기("고양이")')) },
        { category: "sensing", title: "질문하고 답 입력받기", rows: rows('답 = input("이름은 무엇인가요?")'),
            sectionStart: true,
            note: "입력한 답은 문자열이에요. 숫자로 계산하려면 int(답)이나 float(답)을 사용해요." }
    ];

    function availableCards(category, targetName = "고양이") {
        return cards.filter(card => card.category === category).map(card => ({
                ...card,
                rows: card.rows.map(row => {
                    const code = row.code.replaceAll('"고양이"', JSON.stringify(targetName));
                    return { ...row, code, label: code.split("\n")[0] };
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
                    id: `actor-${index + 1}`, label: actor.name, kind: actor.kind, x: actor.x ?? 0, y: actor.y ?? 0,
                    heading: actor.heading ?? 0, width: size[0] * (actor.scale ?? 1),
                    height: size[1] * (actor.scale ?? 1), visible: actor.visible !== false, speech: "",
                    flipHorizontal: false, flipVertical: false
                };
            })
        };
    }

    const api = Object.freeze({ categories, availableCards, copyCode, previewScene });
    if (typeof module !== "undefined" && module.exports) module.exports = api;
    else window.BlackPyPalette = api;
})();
