/**
 * Path 代理，可以在`buildPath`中用于替代`ctx`, 会保存每个path操作的命令到pathCommands属性中
 * 可以用于 isInsidePath 判断以及获取boundingRect
 * 
 * @module zrender/core/PathProxy
 * @author pissang (http://www.github.com/pissang)
 *
 * TODO lineDash
 */
define(function (require) {

    var curve = require('./curve');
    var vec2 = require('./vector');

    var CMD = {
        M: 1,
        L: 2,
        C: 3,
        Q: 4,
        A: 5,
        Z: 6
    };

    var min = [];
    var max = [];
    var v = [];
    var mathMin = Math.min;
    var mathMax = Math.max;
    var mathSqrt = Math.sqrt;

    /**
     * @alias module:zrender/core/PathProxy
     * @constructor
     */
    var PathProxy = function () {

        /**
         * Path data. Stored as flat array
         * @type {Array.<Object>}
         */
        this.data = [];

        this._len = 0;

        this._ctx = null;

        this._xi = 0;
        this._yi = 0;

        this._x0 = 0;
        this._y0 = 0;
    };

    /**
     * 快速计算Path包围盒（并不是最小包围盒）
     * @return {Object}
     */
    PathProxy.prototype = {

        constructor: PathProxy,

        _lineDash: null,

        _dashOffset: 0,

        _dashIdx: 0,

        _dashSum: 0,

        /**
         * @param  {CanvasRenderingContext2D} ctx
         * @return {module:zrender/core/PathProxy}
         */
        beginPath: function (ctx) {
            this._ctx = ctx;

            ctx && ctx.beginPath();

            // Reset
            this._len = 0;

            if (this._lineDash) {
                this._lineDash = null;

                this._dashOffset = 0;
            }

            return this;
        },

        /**
         * @param  {number} x
         * @param  {number} y
         * @return {module:zrender/core/PathProxy}
         */
        moveTo: function (x, y) {
            this._pushData(CMD.M, x, y);
            this._ctx && this._ctx.moveTo(x, y);

            // x0, y0, xi, yi 是记录在 _dashedXXXXTo 方法中使用
            // xi, yi 记录当前点, x0, y0 在 closePath 的时候回到起始点。
            // 有可能在 beginPath 之后直接调用 lineTo，这时候 x0, y0 需要
            // 在 lineTo 方法中记录，这里先不考虑这种情况，dashed line 也只在 IE10- 中不支持
            this._x0 = x;
            this._y0 = y;

            this._xi = x;
            this._yi = y;

            return this;
        },

        /**
         * @param  {number} x
         * @param  {number} y
         * @return {module:zrender/core/PathProxy}
         */
        lineTo: function (x, y) {
            this._pushData(CMD.L, x, y);
            if (this._ctx) {
                this._needsDash() ? this._dashedLineTo(x, y)
                    : this._ctx.lineTo(x, y);
            }
            this._xi = x;
            this._yi = y;
            return this;
        },

        /**
         * @param  {number} x1
         * @param  {number} y1
         * @param  {number} x2
         * @param  {number} y2
         * @param  {number} x3
         * @param  {number} y3
         * @return {module:zrender/core/PathProxy}
         */
        bezierCurveTo: function (x1, y1, x2, y2, x3, y3) {
            this._pushData(CMD.C, x1, y1, x2, y2, x3, y3);
            if (this._ctx) {
                this._needsDash() ? this._dashedBezierTo(x1, y1, x2, y2, x3, y3)
                    : this._ctx.bezierCurveTo(x1, y1, x2, y2, x3, y3);
            }
            this._xi = x3;
            this._yi = y3;
            return this;
        },

        /**
         * @param  {number} x1
         * @param  {number} y1
         * @param  {number} x2
         * @param  {number} y2
         * @return {module:zrender/core/PathProxy}
         */
        quadraticCurveTo: function (x1, y1, x2, y2) {
            this._pushData(CMD.Q, x1, y1, x2, y2);
            if (this._ctx) {
                this._needsDash() ? this._dashedQuadraticTo(x1, y1, x2, y2)
                    : this._ctx.quadraticCurveTo(x1, y1, x2, y2);
            }
            this._xi = x2;
            this._yi = y2;
            return this;
        },

        /**
         * @param  {number} cx
         * @param  {number} cy
         * @param  {number} r
         * @param  {number} startAngle
         * @param  {number} endAngle
         * @param  {boolean} anticlockwise
         * @return {module:zrender/core/PathProxy}
         */
        arc: function (cx, cy, r, startAngle, endAngle, anticlockwise) {
            this._pushData(
                CMD.A, cx, cy, r, r, startAngle, endAngle - startAngle, 0, anticlockwise ? 0 : 1
            );
            this._ctx && this._ctx.arc(cx, cy, r, startAngle, endAngle, anticlockwise);

            this._xi = Math.cos(endAngle) * rx + cx;
            this._xi = Math.sin(endAngle) * rx + cx;
            return this;
        },

        // TODO
        arcTo: function (x1, y1, x2, y2, radius) {
            if (this._ctx) {
                this._ctx.arcTo(x1, y1, x2, y2, radius);
            }
            return this;
        },

        // TODO
        rect: function (x, y, w, h) {
            this._ctx && this._ctx.rect(x, y, w, h);
            return this;
        },

        /**
         * @return {module:zrender/core/PathProxy}
         */
        closePath: function () {
            this._pushData(CMD.Z);
            this._ctx && this._ctx.closePath();

            this._xi = this._x0;
            this._yi = this._y0;
            return this;
        },

        /**
         * @return {module:zrender/core/PathProxy}
         */
        fill: function () {
            this._ctx && this._ctx.fill();
            this.toStatic();
        },

        /**
         * @return {module:zrender/core/PathProxy}
         */
        stroke: function () {
            var ctx = this._ctx;
            if (ctx) {
                if (this._lineDash) {
                    ctx.setLineDash && ctx.setLineDash(this._lineDash);
                    ctx.lineDashOffset = this._dashOffset;
                }
                ctx.stroke();
            }

            this.toStatic();
        },

        /**
         * 必须在其它绘制命令前调用
         * Must be invoked before all other path drawing methods
         * @return {module:zrender/core/PathProxy}
         */
        setLineDash: function (lineDash) {
            if (lineDash instanceof Array) {
                this._lineDash = lineDash;

                this._dashIdx = 0;

                var lineDashSum = 0;
                for (var i = 0; i < lineDash.length; i++) {
                    lineDashSum += lineDash[i];
                }
                this._dashSum = lineDashSum;
            }
            return this;
        },

        /**
         * 必须在其它绘制命令前调用
         * Must be invoked before all other path drawing methods
         * @return {module:zrender/core/PathProxy}
         */
        setLineDashOffset: function (offset) {
            this._dashOffset = offset;
            return this;
        },

        /**
         * 
         * @return {boolean}
         */
        len: function () {
            return this._len;
        },

        /**
         * 填充 Path 数据。
         * 尽量复用而不申明新的数组。大部分图形重绘的指令数据长度都是不变的。
         */
        _pushData: function (cmd) {
            var data = this.data;
            if (this._len + arguments.length > data.length) {
                // 因为之前的数组已经转换成静态的 Float32Array
                // 所以不够用时需要扩展一个新的动态数组
                this._expandData();
                data = this.data;
            }
            for (var i = 0; i < arguments.length; i++) {
                data[this._len++] = arguments[i];
            }

            this._prevCmd = cmd;
        },

        _expandData: function () {
            // Only if data is Float32Array
            if (! (this.data instanceof Array)) {
                var newData = [];
                for (var i = 0; i < this._len; i++) {
                    newData[i] = this.data[i];
                }
                this.data = newData;
            }
        },

        /**
         * If needs js implemented dashed line
         * @return {boolean}
         * @private
         */
        _needsDash: function () {
            return this._lineDash && !this._ctx.setLineDash;
            // return this._lineDash;
        },

        _dashedLineTo: function (x1, y1) {
            var offset = this._dashOffset % this._dashSum;
            var lineDash = this._lineDash;
            var ctx = this._ctx;

            var xi = this._xi;
            var yi = this._yi;
            var dx = x1 - xi;
            var dy = y1 - yi;
            var dist = mathSqrt(dx * dx + dy * dy);
            var x = xi;
            var y = yi;
            var dash;
            var len = lineDash.length;
            var idx;
            dx /= dist;
            dy /= dist;
            x -= offset * dx;
            y -= offset * dy;

            while ((dx >= 0 && x <= x1) || (dx < 0 && x > x1)) {
                idx = this._dashIdx;
                dash = lineDash[idx];
                x += dx * dash;
                y += dy * dash;
                this._dashIdx = (idx + 1) % len;
                // Skip positive offset
                if ((dx > 0 && x < xi) || (dx < 0 && x > xi)) {
                    continue;
                }
                ctx[idx % 2 ? 'moveTo' : 'lineTo'](
                    dx >= 0 ? mathMin(x, x1) : mathMax(x, x1),
                    dy >= 0 ? mathMin(y, y1) : mathMax(y, y1)
                );
            }
            // Offset for next lineTo
            dx = x - x1;
            dy = y - y1;
            this._dashOffset = -mathSqrt(dx * dx + dy * dy);
        },

        _dashedBezierTo: function (x1, y1, x2, y2, x3, y3) {
        },

        _dashedQuadraticTo: function (x1, y1, x2, y2) {
        },

        /**
         * 转成静态的 Float32Array 减少堆内存占用
         * Convert dynamic array to static Float32Array
         * @return {[type]} [description]
         */
        toStatic: function () {
            if (typeof Float32Array != 'undefined' 
                && (this.data instanceof Array)
            ) {
                this.data.length = this._len;
                this.data = new Float32Array(this.data);
            };
        },

        fastBoundingRect: function () {
            var data = this.data;
            min[0] = min[1] = Infinity;
            max[0] = max[1] = -Infinity;
            for (var i = 0; i < this._len;) {
                var cmd = data[i++];
                var nPoint = 0;
                switch (cmd) {
                    case CMD.M:
                        nPoint = 1;
                        break;
                    case CMD.L:
                        nPoint = 1;
                        break;
                    case CMD.C:
                        nPoint = 3;
                        break;
                    case CMD.Q:
                        nPoint = 2;
                        break;
                    case CMD.A:
                        var cx = data[i];
                        var cy = data[i + 1];
                        var rx = data[i + 2];
                        var ry = data[i + 3];
                        min[0] = mathMin(min[0], min[0], cx - rx);
                        min[1] = mathMin(min[1], min[1], cy - ry);
                        max[0] = mathMax(max[0], max[0], cx + rx);
                        max[1] = mathMax(max[1], max[1], cy + ry);
                        i += 8;
                        break;
                }
                for (var j = 0; j < nPoint; j++) {    
                    min[0] = mathMin(min[0], min[0], data[i]);
                    max[0] = mathMax(max[0], max[0], data[i++]);
                    min[1] = mathMin(min[1], min[1], data[i]);
                    max[1] = mathMax(max[1], max[1], data[i++]);
                }
            }

            return {
                x: min[0],
                y: min[1],
                width: max[0] - min[0],
                height: max[1] - min[1]
            };
        },

        /**
         * Rebuild path from current data
         * Rebuild path will not consider javascript implemented line dash.
         * @param {CanvasRenderingContext} ctx
         */
        rebuildPath: function (ctx) {
            var d = this.data;
            for (var i = 0; i < this._len;) {
                var cmd = d[i++];
                switch (cmd) {
                    case CMD.M:
                        ctx.moveTo(d[i++], d[i++]);
                        break;
                    case CMD.L:
                        ctx.lineTo(d[i++], d[i++]);
                        break;
                    case CMD.C:
                        ctx.bezierCurveTo(
                            d[i++], d[i++], d[i++], d[i++], d[i++], d[i++]
                        );
                        break;
                    case CMD.Q:
                        ctx.bezierCurveTo(d[i++], d[i++], d[i++], d[i++]);
                        break;
                    case CMD.A:
                        var cx = d[i++];
                        var cy = d[i++];
                        var rx = d[i++];
                        var ry = d[i++];
                        var theta = d[i++];
                        var dTheta = d[i++];
                        var psi = d[i++];
                        var fs = d[i++];
                        var r = (rx > ry) ? rx : ry;
                        var scaleX = (rx > ry) ? 1 : rx / ry;
                        var scaleY = (rx > ry) ? ry / rx : 1;
                        var isEllipse = Math.abs(rx - ry) < 1e-3;
                        if (isEllipse) {
                            ctx.translate(cx, cy);
                            ctx.rotate(psi);
                            ctx.scale(scaleX, scaleY);
                            ctx.arc(0, 0, r, theta, theta + dTheta, 1 - fs);
                            ctx.scale(1 / scaleX, 1 / scaleY);
                            ctx.rotate(-psi);
                            ctx.translate(-cx, -cy);
                        }
                        else {
                            ctx.arc(cx, cy, r, theta, theta + dTheta, 1 - fs);
                        }
                        break;
                    case CMD.Z:
                        ctx.closePath();
                }
            }
        }
    };

    PathProxy.CMD = CMD;

    return PathProxy;
});