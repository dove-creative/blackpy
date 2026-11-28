"use strict";

(() => {
    const width = 220;
    const height = 100;

    function hit(displays, point) {
        return [...displays].reverse().find(display =>
            Math.abs(point.x - display.x) <= width * display.scale / 2
            && Math.abs(point.y - display.y) <= height * display.scale / 2,
        );
    }

    function draw(context, display) {
        context.save();
        context.translate(400 + display.x, 300 - display.y);
        context.scale(display.scale, display.scale);
        context.beginPath();
        context.roundRect(-width / 2, -height / 2, width, height, 16);
        context.fillStyle = "#fffdf3";
        context.fill();
        context.strokeStyle = "#d89a3a";
        context.lineWidth = 3;
        context.stroke();
        context.clip();
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillStyle = "#735229";
        context.font = '600 18px "Malgun Gothic", sans-serif';
        context.fillText(display.variable || display.name, 0, -27, width - 24);
        context.fillStyle = "#294b4b";
        context.font = '700 32px "Malgun Gothic", sans-serif';
        const value = display.variable ? display.text : "변수 연결";
        context.fillText(value.replace(/\s+/g, " "), 0, 13, width - 24);
        context.restore();
    }

    const api = Object.freeze({ hit, draw });
    if (typeof module !== "undefined" && module.exports) module.exports = api;
    else window.BlackPyDisplay = api;
})();
