"use strict";

// Original canvas drawings for BlackPy's movement and game activities.
(() => {
    const width = 800;
    const height = 600;
    const outline = "#294b4b";
    const backgroundCache = new Map();

    function path(context, commands, fill, stroke = null, lineWidth = 3) {
        const shape = new Path2D(commands);
        context.fillStyle = fill;
        context.fill(shape);

        if (stroke) {
            context.strokeStyle = stroke;
            context.lineWidth = lineWidth;
            context.stroke(shape);
        }
    }

    function ellipse(context, x, y, radiusX, radiusY, fill, stroke = null, lineWidth = 3) {
        context.beginPath();
        context.ellipse(x, y, radiusX, radiusY, 0, 0, Math.PI * 2);
        context.fillStyle = fill;
        context.fill();

        if (stroke) {
            context.lineWidth = lineWidth;
            context.strokeStyle = stroke;
            context.stroke();
        }
    }

    function rounded(context, x, y, boxWidth, boxHeight, radius, fill, stroke = null) {
        context.beginPath();
        context.roundRect(x, y, boxWidth, boxHeight, radius);
        context.fillStyle = fill;
        context.fill();

        if (stroke) {
            context.lineWidth = 3;
            context.strokeStyle = stroke;
            context.stroke();
        }
    }

    function line(context, points, color, lineWidth = 3) {
        context.beginPath();
        context.moveTo(points[0][0], points[0][1]);

        for (const point of points.slice(1)) {
            context.lineTo(point[0], point[1]);
        }

        context.strokeStyle = color;
        context.lineWidth = lineWidth;
        context.stroke();
    }

    function cloud(context, x, y, scale = 1) {
        context.save();
        context.translate(x, y);
        context.scale(scale, scale);
        ellipse(context, -24, 7, 28, 17, "#ffffffd9");
        ellipse(context, 0, -4, 28, 25, "#ffffffd9");
        ellipse(context, 28, 7, 31, 17, "#ffffffd9");
        context.restore();
    }

    function tree(context, x, y, scale, leaves) {
        context.save();
        context.translate(x, y);
        context.scale(scale, scale);
        rounded(context, -9, -7, 18, 74, 7, "#b38462");
        ellipse(context, -26, -20, 35, 38, leaves);
        ellipse(context, 24, -20, 36, 38, leaves);
        ellipse(context, 0, -51, 39, 43, leaves);
        line(context, [[0, 10], [0, 48]], "#93694e", 3);
        context.restore();
    }

    function sky(context, top, bottom) {
        const gradient = context.createLinearGradient(0, 0, 0, height);
        gradient.addColorStop(0, top);
        gradient.addColorStop(1, bottom);
        context.fillStyle = gradient;
        context.fillRect(0, 0, width, height);
    }

    function drawCity(context) {
        sky(context, "#d7edf2", "#f5f8ed");
        ellipse(context, 678, 77, 39, 39, "#f5d879");
        cloud(context, 135, 78, 1.05);
        cloud(context, 422, 105, 0.75);
        const buildings = [
            [25, 151, 109, "#9bb9c6"], [146, 119, 95, "#e4b19d"],
            [254, 179, 118, "#b5c6ac"], [418, 137, 104, "#c0bad5"],
            [539, 185, 87, "#e7cd95"], [672, 150, 105, "#9eb9bd"]
        ];

        for (const [x, y, buildingWidth, color] of buildings) {
            rounded(context, x, y, buildingWidth, 295 - y, 8, color);

            for (let windowY = y + 20; windowY < 267; windowY += 35) {
                for (let windowX = x + 17; windowX < x + buildingWidth - 15; windowX += 30) {
                    rounded(context, windowX, windowY, 15, 19, 3, "#f9f5db");
                }
            }
        }

        context.fillStyle = "#b4c997";
        context.fillRect(0, 280, width, 37);
        context.fillStyle = "#e7dfcb";
        context.fillRect(0, 310, width, 24);
        context.fillStyle = "#879aa3";
        context.fillRect(0, 334, width, 186);
        context.fillStyle = "#f8e7ac";

        for (let x = 10; x < width; x += 105) {
            context.fillRect(x, 423, 57, 8);
        }

        context.fillStyle = "#d7ddc4";
        context.fillRect(0, 520, width, 80);
        tree(context, 395, 261, 0.5, "#71a88b");
        tree(context, 642, 267, 0.45, "#71a88b");
    }

    function drawDance(context) {
        sky(context, "#d8d9ef", "#f4dce8");
        path(context, "M100 0L270 480H30Z", "#fff7c640");
        path(context, "M700 0L770 480H530Z", "#c8f4f140");
        line(context, [[0, 44], [180, 70], [400, 83], [620, 70], [800, 44]], "#8a86ab", 3);
        const lightColors = ["#f3bf81", "#a9cec1", "#d9a6bc", "#f1d38d", "#a6c1df"];

        for (let index = 0; index < 9; index++) {
            ellipse(context, 40 + index * 90, 56 + Math.sin(index / 8 * Math.PI) * 28,
                10, 14, lightColors[index % lightColors.length]);
        }

        rounded(context, 49, 146, 702, 355, 40, "#ffffff32", "#ffffff65");
        ellipse(context, 400, 514, 345, 63, "#a89dbb");
        ellipse(context, 400, 490, 345, 65, "#e4bbcf", "#fff3ea");
        line(context, [[100, 491], [700, 491]], "#c29dbb", 2);
        line(context, [[400, 429], [400, 549]], "#c29dbb", 2);
        path(context, "M71 190V240Q50 235 50 249Q54 261 73 253V209L99 201V231Q78 227 79 241"
            + "Q82 252 101 244V179Z", "#8f8db650");
        path(context, "M705 193V243Q684 238 684 252Q688 264 707 256V212L733 204V234"
            + "Q712 230 713 244Q716 255 735 247V182Z", "#8f8db650");
    }

    function drawTrack(context) {
        sky(context, "#d9eef1", "#f0f6e8");
        cloud(context, 135, 65, 0.85);
        cloud(context, 542, 80, 1);
        context.fillStyle = "#b9d4a9";
        context.fillRect(0, 135, width, 465);
        rounded(context, 19, 163, 762, 371, 55, "#d8a08d");
        rounded(context, 31, 174, 738, 348, 46, "#c98e7e");

        for (const y of [196, 270, 344, 418, 492]) {
            line(context, [[42, y], [758, y]], "#f6e8d7", 3);
        }

        for (let row = 0; row < 10; row++) {
            for (let column = 0; column < 2; column++) {
                context.fillStyle = (row + column) % 2 === 0 ? "#fbf4e7" : "#576c67";
                context.fillRect(660 + column * 16, 181 + row * 33, 16, 33);
            }
        }

        line(context, [[99, 179], [99, 513]], "#f6e8d7", 4);
        context.font = '600 28px "Malgun Gothic", sans-serif';
        context.textAlign = "center";
        context.fillStyle = outline;
        context.fillText("도착", 676, 151);
        tree(context, 747, 93, 0.53, "#7cac8a");
    }

    function drawCourt(context) {
        sky(context, "#e9eadf", "#fff4dc");
        context.fillStyle = "#d4ddd3";
        context.fillRect(0, 0, width, 270);

        for (const x of [60, 303, 546]) {
            rounded(context, x, 41, 192, 130, 9, "#b1ced2", "#f7f9e9");
            line(context, [[x + 96, 43], [x + 96, 170]], "#f7f9e9", 6);
        }

        context.fillStyle = "#e2bd89";
        context.fillRect(0, 270, width, 330);

        for (let y = 300; y < 600; y += 48) {
            line(context, [[0, y], [800, y]], "#d4ab78", 2);
        }

        line(context, [[42, 326], [758, 326], [758, 555], [42, 555], [42, 326]], "#fff5de", 4);
        ellipse(context, 400, 440, 85, 65, "#e2bd89", "#fff5de", 4);
        line(context, [[400, 326], [400, 555]], "#fff5de", 4);
        rounded(context, 628, 148, 115, 80, 5, "#f5f4e7", "#7d9b9c");
        rounded(context, 663, 178, 45, 35, 2, "#f5f4e7", "#d78e70");
        path(context, "M649 230L661 268H712L724 230", "#ffffff75", "#e3e4d8", 3);
        ellipse(context, 686, 229, 38, 8, "#ffffff30", "#cb785b", 5);
    }

    function drawForest(context) {
        sky(context, "#334862", "#849997");
        ellipse(context, 627, 83, 39, 39, "#f5e6b2");
        ellipse(context, 641, 72, 35, 35, "#3e5268");

        for (let index = 0; index < 32; index++) {
            const x = (index * 139 + 39) % width;
            const y = (index * 61 + 23) % 240;
            ellipse(context, x, y, index % 3 === 0 ? 2.7 : 1.5, 1.8, "#fff3c5");
        }

        path(context, "M0 400Q190 282 400 389Q610 304 800 382V600H0Z", "#4b786d");
        path(context, "M0 490Q200 410 440 472Q650 429 800 470V600H0Z", "#779885");
        path(context, "M286 600Q447 506 442 439Q428 413 385 404"
            + "Q463 416 476 443Q512 517 476 600Z", "#b7b9a0");
        tree(context, 45, 305, 1.5, "#345d5b");
        tree(context, 142, 272, 0.8, "#426e64");
        tree(context, 756, 328, 1.5, "#345d5b");
        tree(context, 660, 287, 0.8, "#426e64");

        for (const [x, y] of [[70, 491], [199, 531], [594, 507], [716, 552]]) {
            ellipse(context, x, y, 5, 5, "#f1dc8b");
            ellipse(context, x, y, 12, 12, "#f1dc8b16");
        }
    }

    function background(name) {
        const supported = ["plain", "city", "dance", "track", "court", "forest"];
        const key = supported.includes(name) ? name : "plain";
        if (backgroundCache.has(key)) return backgroundCache.get(key);

        const layer = document.createElement("canvas");
        layer.width = width;
        layer.height = height;
        const context = layer.getContext("2d");
        context.lineCap = "round";
        context.lineJoin = "round";
        const painters = { city: drawCity, dance: drawDance, track: drawTrack, court: drawCourt, forest: drawForest };

        if (painters[key]) {
            painters[key](context);
        } else {
            sky(context, "#f0f7f0", "#fbf8ed");
            ellipse(context, 400, 499, 330, 48, "#dbe8db");
        }

        backgroundCache.set(key, layer);
        return layer;
    }

    function drawCar(context, color) {
        path(context, "M-46 10L-40-13H-21L-7-36H21L37-12L47-5V24H-46Z", color, outline);
        path(context, "M-16-13L-3-30H16L29-13Z", "#d9f1f0", outline, 2);
        line(context, [[8, -28], [8, -12]], outline, 2);
        rounded(context, -45, 12, 92, 15, 6, color, outline);
        rounded(context, 37, -3, 10, 8, 2, "#fff0b6");
        ellipse(context, -27, 26, 13, 14, outline);
        ellipse(context, 29, 26, 13, 14, outline);
        ellipse(context, -27, 26, 6, 6, "#e3e9d9");
        ellipse(context, 29, 26, 6, 6, "#e3e9d9");
        line(context, [[-12, 0], [-3, 0]], outline, 2);
    }

    function drawCat(context, color) {
        path(context, "M-28 12Q-48 14-44-16Q-40-26-34-19Q-39-1-27 0Z", color, outline);
        ellipse(context, -9, 14, 27, 23, color, outline);
        path(context, "M5-6L4-36L20-26L37-35L43-9Q52 15 29 19Q5 20 5-6Z", color, outline);
        path(context, "M10-29L11-15L18-23Z M30-24L37-28L39-15Z", "#f3bbad");
        ellipse(context, 30, -7, 3, 4, outline);
        ellipse(context, 45, 3, 4, 3, "#b56c63");
        line(context, [[34, 9], [47, 13]], outline, 2);
        line(context, [[-23, 30], [-23, 41], [-12, 41]], outline, 5);
        line(context, [[10, 29], [10, 41], [21, 41]], outline, 5);
        line(context, [[-17, -2], [-12, 6]], "#ffffff70", 4);
        line(context, [[-4, -7], [1, 3]], "#ffffff70", 4);
    }

    function drawRabbit(context, color) {
        ellipse(context, -36, 23, 13, 13, "#fff9ee", outline);
        ellipse(context, -9, 18, 29, 23, color, outline);
        ellipse(context, 10, -25, 8, 24, color, outline);
        ellipse(context, 27, -25, 8, 24, color, outline);
        ellipse(context, 10, -28, 3, 14, "#e8b1b0");
        ellipse(context, 27, -28, 3, 14, "#e8b1b0");
        ellipse(context, 25, 1, 22, 21, color, outline);
        ellipse(context, 33, -3, 3, 4, outline);
        ellipse(context, 46, 6, 4, 3, "#b67472");
        rounded(context, -26, 32, 25, 11, 5, color, outline);
        rounded(context, 10, 31, 25, 11, 5, color, outline);
    }

    function drawBall(context, color) {
        ellipse(context, 0, 0, 46, 46, color, outline);
        context.save();
        context.beginPath();
        context.arc(0, 0, 46, 0, Math.PI * 2);
        context.clip();
        line(context, [[-48, 0], [48, 0]], outline, 3);
        line(context, [[0, -48], [0, 48]], outline, 3);
        context.strokeStyle = outline;
        context.lineWidth = 3;
        context.beginPath();
        context.ellipse(-44, 0, 24, 52, 0, 0, Math.PI * 2);
        context.ellipse(44, 0, 24, 52, 0, 0, Math.PI * 2);
        context.stroke();
        ellipse(context, -17, -21, 11, 7, "#ffffff36");
        context.restore();
    }

    function drawBat(context, color) {
        path(context, "M-9-7Q-28-36-48-21Q-33-12-47 9Q-24-5-20 24L-5 9Z", color, outline);
        path(context, "M9-7Q28-36 48-21Q33-12 47 9Q24-5 20 24L5 9Z", color, outline);
        path(context, "M-14-11L-15-32L-3-22L9-31L15-9Q23 22 0 30Q-23 22-14-11Z", color, outline);
        ellipse(context, -6, -4, 4, 5, "#fff8df");
        ellipse(context, 8, -4, 4, 5, "#fff8df");
        ellipse(context, -5, -3, 2, 3, outline);
        ellipse(context, 9, -3, 2, 3, outline);
        path(context, "M-5 10Q2 17 9 10", "#edb6ac", outline, 2);
    }

    function drawGhost(context, color) {
        path(context, "M-40 42V-6Q-40-46 0-46Q40-46 40-6V42L20 30 0 42-20 30Z", color, outline);
        ellipse(context, -14, -6, 5, 8, outline);
        ellipse(context, 14, -6, 5, 8, outline);
        path(context, "M-12 15Q0 29 12 15", "#eeb8ba", outline, 2);
    }

    function drawStar(context, color) {
        path(context, "M0-47L14-16 47-14 23 10 29 44 0 27-29 44-23 10-47-14-14-16Z", color, outline);
        ellipse(context, -10, -2, 3, 5, outline);
        ellipse(context, 10, -2, 3, 5, outline);
    }

    function drawBasket(context, color) {
        path(context, "M-46-25L-34 43H34L46-25Z", color, outline);
        rounded(context, -49, -34, 98, 16, 6, "#f4d6a8", outline);
        line(context, [[-23, -15], [-17, 34]], "#f4d6a8", 5);
        line(context, [[0, -15], [0, 34]], "#f4d6a8", 5);
        line(context, [[23, -15], [17, 34]], "#f4d6a8", 5);
    }

    function drawPaddle(context, color) {
        rounded(context, -48, -43, 96, 86, 12, color, outline);
        rounded(context, -36, -26, 72, 16, 7, "#ffffff75");
    }

    function drawRocket(context, color) {
        path(context, "M-33-25L-47-44-5-29Q27-27 48 0Q27 27-5 29L-47 44-33 25Z", color, outline);
        ellipse(context, 13, 0, 15, 21, "#c4edf1", outline);
        path(context, "M-35-17L-49 0-35 17Z", "#f5b45e", outline);
    }

    function drawFlag(context, color) {
        line(context, [[-27, 44], [-27, -45]], outline, 6);
        path(context, "M-24-44H43L18-13 43 14H-24Z", color, outline);
        ellipse(context, -21, 44, 26, 5, "#6a9a79");
    }

    function drawPlanet(context, color) {
        ellipse(context, 0, 0, 43, 43, color, outline);
        path(context, "M-30-26L-9-32 1-12-12 2-36-4Z M10 13L29 4 37 21 19 35 3 29Z", "#86bb8c");
        ellipse(context, -16, -19, 8, 5, "#ffffff65");
    }

    function drawSprite(context, sprite, image = null) {
        if (!sprite.visible) return;
        const painters = {
            car: drawCar, cat: drawCat, rabbit: drawRabbit, ball: drawBall, bat: drawBat,
            ghost: drawGhost, star: drawStar, basket: drawBasket, paddle: drawPaddle,
            rocket: drawRocket, flag: drawFlag, planet: drawPlanet
        };
        const defaults = { car: "#dc806c", cat: "#f0bd63", rabbit: "#f7eadc", ball: "#e8a15e", bat: "#a89bc5" };
        const painter = painters[sprite.kind] || drawCat;
        const x = width / 2 + sprite.x;
        const y = height / 2 - sprite.y;

        context.save();
        context.translate(x, y);
        context.rotate(-sprite.heading * Math.PI / 180);
        context.scale(sprite.width / 100 * (sprite.flipHorizontal ? -1 : 1),
            sprite.height / 100 * (sprite.flipVertical ? -1 : 1));
        context.lineJoin = "round";
        context.lineCap = "round";
        if (image) {
            // A project image fills the same box as the built-in drawing of its kind.
            context.drawImage(image, -50, -50, 100, 100);
        } else {
            painter(context, sprite.color || defaults[sprite.kind] || defaults.cat);
        }
        context.restore();

        if (sprite.label) {
            context.save();
            context.font = '600 20px "Malgun Gothic", sans-serif';
            context.textAlign = "center";
            context.textBaseline = "middle";
            const textWidth = context.measureText(sprite.label).width;
            const labelY = y + sprite.height / 2 + 25;
            rounded(context, x - textWidth / 2 - 12, labelY - 21, textWidth + 24, 42, 12, "#fffdf3ed");
            context.fillStyle = outline;
            context.fillText(sprite.label, x, labelY);
            context.restore();
        }
    }

    function drawSpeech(context, sprite) {
        if (!sprite.visible || !sprite.speech) return;
        context.save();
        context.font = '20px "Malgun Gothic", sans-serif';
        context.textAlign = "left";
        context.textBaseline = "middle";
        const lines = [];
        let line = "";

        for (const character of sprite.speech) {
            if (character === "\n" || (line && context.measureText(line + character).width > 240)) {
                lines.push(line);
                line = character === "\n" ? "" : character;
            } else {
                line += character;
            }
        }

        lines.push(line);
        const boxWidth = Math.max(45, ...lines.map(text => context.measureText(text).width + 28));
        const boxHeight = lines.length * 26 + 18;
        const x = Math.max(8, Math.min(width - boxWidth - 8, width / 2 + sprite.x - boxWidth / 2));
        const y = Math.max(8, Math.min(height - boxHeight - 8,
            height / 2 - sprite.y - sprite.height / 2 - boxHeight - 14));
        rounded(context, x, y, boxWidth, boxHeight, 12, "#fffef7", "#bacbb9");
        context.fillStyle = outline;
        lines.forEach((text, index) => context.fillText(text, x + 14, y + 22 + index * 26));
        context.restore();
    }

    function draw(context, scene, images = {}) {
        const backgroundImage = images.background && scene.background === images.backgroundKind
            ? images.background : null;
        context.drawImage(backgroundImage || background(scene.background), 0, 0, width, height);

        for (const sprite of scene.sprites) {
            drawSprite(context, sprite, images.actors?.get(sprite.id) || null);
        }

        for (const sprite of scene.sprites) {
            drawSpeech(context, sprite);
        }
    }

    window.BlackPySceneRenderer = Object.freeze({ draw });
})();
