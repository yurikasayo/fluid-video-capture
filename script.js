let video;
let gl;

const dt = 0.3;
const Re = 1.0;
const h = 1.0;
const steps = 20;

// 現在のフレーム番号
// current frame
let vFrame = 0;
let pFrame = 0;
let dFrame = 0;

window.onload = function() {
    video = document.getElementById("videoInput");
    navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
    }).then(stream => {
        video.srcObject = stream;
        if (video.width == 0) {
            video.width = stream.getVideoTracks()[0].getSettings().width;
            video.height = stream.getVideoTracks()[0].getSettings().height;
        }
        video.play();
    }).catch(e => {
        console.log(e);
    })
    
    video.addEventListener('play', main);
}

function main() {
    const canvas = document.getElementById("canvasOutput");
    const width = canvas.width = video.width;
    const height = canvas.height = video.height;
    const frameWidth = Math.floor(width / 4);
    const frameHeight = Math.floor(height / 4);

    gl = canvas.getContext('webgl');
    if (!gl) {
        alert('Unable to initialize WebGL. Your browser or machine may not support it.');
        return;
    }

    const velocity = [];
    const pressure = [];

    for (let i = 0; i < 2; i++) {
        velocity.push(initFrame(frameWidth, frameHeight));
        gl.bindFramebuffer(gl.FRAMEBUFFER, velocity[i].fb);
        gl.clearColor(0.5, 0.5, 0.0, 1.0);
        gl.clearDepth(1.0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        pressure.push(initFrame(frameWidth, frameHeight));
        gl.bindFramebuffer(gl.FRAMEBUFFER, pressure[i].fb);
        gl.clearColor(0.5, 0.0, 0.0, 1.0);
        gl.clearDepth(1.0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    }

    // シェーダ―の記述
    // write shaders
    const vert = `
    // 共通の頂点シェーダー

    attribute vec2 aPosition;

    uniform mat4 uModelViewMatrix;

    void main(void) {
        gl_Position = uModelViewMatrix * vec4(aPosition, 0.0, 1.0);
    }
    `;
    const boundaryFrag = `
    // 速度場の境界条件
    precision mediump float;

    uniform sampler2D velocity;
    uniform vec2 resolution;

    void main() {
        vec2 pos = gl_FragCoord.xy;
        vec2 uv = texture2D(velocity, pos / resolution).xy;

        if (pos.y < 1.0) {
            vec2 uv0 = texture2D(velocity, (pos + vec2(0.0, 1.0)) / resolution).xy;
            uv = 1.0 - uv0;
        } else if (pos.y > resolution.y - 1.0) {
            vec2 uv0 = texture2D(velocity, (pos - vec2(0.0, 1.0)) / resolution).xy;
            uv = 1.0 - uv0;
        } else if (pos.x < 1.0) {
            vec2 uv0 = texture2D(velocity, (pos + vec2(1.0, 0.0)) / resolution).xy;
            uv = 1.0 - uv0;
        } else if (pos.x >= resolution.x - 1.0) {
            vec2 uv0 = texture2D(velocity, (pos - vec2(1.0, 0.0)) / resolution).xy;
            uv = 1.0 - uv0;
        }

        gl_FragColor = vec4(uv, 0.0, 1.0);
    }
    `;
    const addFrag = `
    precision mediump float;

    uniform sampler2D velocity;
    uniform sampler2D texture;
    uniform vec2 resolution;
    
    void main() {
        vec2 pos = gl_FragCoord.xy;
        vec2 add = (texture2D(texture, pos / resolution).xy - 0.5);

        gl_FragColor = texture2D(velocity, pos / resolution);
        gl_FragColor.xy += add * 0.1;
    }
    `;
    const diffuseFrag  = `
    // diffuse : 拡散項
    precision mediump float;

    uniform sampler2D texture;
    uniform vec2 resolution;
    uniform float re;
    uniform float dt;
    uniform float h;

    void main() {
        vec2 pos = gl_FragCoord.xy;

        vec3 col0 = texture2D(texture, pos / resolution).rgb;
        vec3 col1 = texture2D(texture, (pos + vec2(1.0, 0.0)) / resolution).rgb;
        vec3 col2 = texture2D(texture, (pos - vec2(1.0, 0.0)) / resolution).rgb;
        vec3 col3 = texture2D(texture, (pos + vec2(0.0, 1.0)) / resolution).rgb;
        vec3 col4 = texture2D(texture, (pos - vec2(0.0, 1.0)) / resolution).rgb;
        
        vec3 laplacian = (col1 + col2 + col3 + col4 - 4.0 * col0) / (h * h);

        vec3 color = col0 + dt * laplacian / re;

        gl_FragColor = vec4(color, 1.0);
    }
    `;
    const advectFrag   = `
    // advect : 移流項
    precision mediump float;

    uniform sampler2D velocity;
    uniform sampler2D texture;
    uniform vec2 resolution;
    uniform float dt;

    void main() {
        vec2 pos = gl_FragCoord.xy / resolution;
        vec2 pos_to = pos - (texture2D(velocity, pos).xy - 0.5) * dt ;

        vec3 color = texture2D(texture, pos_to).rgb;
        
        gl_FragColor = vec4(color, 1.0);
    }
    `;
    const pressureFrag = `
    // 圧力場の計算
    precision mediump float;

    uniform sampler2D pressure;
    uniform sampler2D velocity;
    uniform vec2 resolution;
    uniform float dt;
    uniform float h;

    void main() {
        vec2 pos = gl_FragCoord.xy;

        float p1 = texture2D(pressure, (pos + vec2(1.0, 0.0)) / resolution).x;
        float p2 = texture2D(pressure, (pos - vec2(1.0, 0.0)) / resolution).x;
        float p3 = texture2D(pressure, (pos + vec2(0.0, 1.0)) / resolution).x;
        float p4 = texture2D(pressure, (pos - vec2(0.0, 1.0)) / resolution).x;

        float u1 = texture2D(velocity, (pos + vec2(1.0, 0.0)) / resolution).x;
        float u2 = texture2D(velocity, (pos - vec2(1.0, 0.0)) / resolution).x;
        float v1 = texture2D(velocity, (pos + vec2(0.0, 1.0)) / resolution).y;
        float v2 = texture2D(velocity, (pos - vec2(0.0, 1.0)) / resolution).y;

        float div = (u1 - u2 + v1 - v2) * h / 2.0;
        float p = (p1 + p2 + p3 + p4 - div) / 4.0;

        // 境界条件
        if (pos.y < 1.0) {
            p = p3;
        } else if (pos.y > resolution.y - 1.0) {
            p = p4;
        } else if (pos.x < 1.0) {
            p = p1;
        } else if (pos.x >= resolution.x - 1.0) {
            p = p2;
        }

        gl_FragColor = vec4(p, 0.0, 0.0, 1.0);
    }
    `;
    const projectFrag  = `
    // 圧力項
    precision mediump float;

    uniform sampler2D pressure;
    uniform sampler2D velocity;
    uniform vec2 resolution;
    uniform float dt;
    uniform float h;

    void main() {
        vec2 pos = gl_FragCoord.xy;

        float p1 = texture2D(pressure, (pos + vec2(1.0, 0.0)) / resolution).x;
        float p2 = texture2D(pressure, (pos - vec2(1.0, 0.0)) / resolution).x;
        float p3 = texture2D(pressure, (pos + vec2(0.0, 1.0)) / resolution).x;
        float p4 = texture2D(pressure, (pos - vec2(0.0, 1.0)) / resolution).x;

        vec2 uv = texture2D(velocity, pos / resolution).xy;
        uv -= vec2(p1 - p2, p3 - p4) / (2.0 * h);

        gl_FragColor = vec4(uv, 0.0, 1.0);
    }
    `;
    const displayFrag  = `
    // 描画用
    precision mediump float;

    uniform sampler2D texture;
    uniform sampler2D velocity;
    uniform vec2 resolution;

    void main() {
        vec2 pos = 1.0 - gl_FragCoord.xy / resolution;
        vec2 pos_to = pos - (texture2D(velocity, pos).xy - 0.5) * 0.5;
        gl_FragColor = texture2D(texture, pos_to);
        //gl_FragColor.rgb = texture2D(velocity, pos).rgb;
    }
    `;

    // シェーダーの初期化
    // initialize shader programs
    const boundaryShader = initShader(vert, boundaryFrag);
    const addShader      = initShader(vert, addFrag);
    const diffuseShader  = initShader(vert, diffuseFrag);
    const advectShader   = initShader(vert, advectFrag);
    const pressureShader = initShader(vert, pressureFrag);
    const projectShader  = initShader(vert, projectFrag);
    const displayShader  = initShader(vert, displayFrag);

    // attribute変数の位置を取得
    // get the location of attribute variables
    const boundaryAttrib = gl.getAttribLocation(boundaryShader, 'aPosition');
    const addAttrib      = gl.getAttribLocation(addShader,      'aPosition');
    const diffuseAttrib  = gl.getAttribLocation(diffuseShader,  'aPosition');
    const advectAttrib   = gl.getAttribLocation(advectShader,   'aPosition');
    const pressureAttrib = gl.getAttribLocation(pressureShader, 'aPosition');
    const projectAttrib  = gl.getAttribLocation(projectShader,  'aPosition');
    const displayAttrib  = gl.getAttribLocation(displayShader,  'aPosition');

    // uniform変数の位置を取得
    // get the location of uniform variables
    const boundaryUniforms = {
        modelviewMatrix : gl.getUniformLocation(boundaryShader, 'uModelViewMatrix'),
        velocity        : gl.getUniformLocation(boundaryShader, 'velocity'),
        resolution      : gl.getUniformLocation(boundaryShader, 'resolution'),
    };
    const addUniforms = {
        modelviewMatrix : gl.getUniformLocation(addShader, 'uModelViewMatrix'),
        velocity        : gl.getUniformLocation(addShader, 'velocity'),
        texture         : gl.getUniformLocation(addShader, 'texture'),
        resolution      : gl.getUniformLocation(addShader, 'resolution'),
    };
    const diffuseUniforms = {
        modelviewMatrix : gl.getUniformLocation(diffuseShader, 'uModelViewMatrix'),
        texture         : gl.getUniformLocation(diffuseShader, 'texture'),
        resolution      : gl.getUniformLocation(diffuseShader, 'resolution'),
        re              : gl.getUniformLocation(diffuseShader, 're'),
        dt              : gl.getUniformLocation(diffuseShader, 'dt'),
        h               : gl.getUniformLocation(diffuseShader, 'h'),
    };
    const advectUniforms = {
        modelviewMatrix : gl.getUniformLocation(advectShader, 'uModelViewMatrix'),
        velocity        : gl.getUniformLocation(advectShader, 'velocity'),
        texture         : gl.getUniformLocation(advectShader, 'texture'),
        resolution      : gl.getUniformLocation(advectShader, 'resolution'),
        dt              : gl.getUniformLocation(advectShader, 'dt'),
    };
    const pressureUniforms = {
        modelviewMatrix : gl.getUniformLocation(pressureShader, 'uModelViewMatrix'),
        velocity        : gl.getUniformLocation(pressureShader, 'velocity'),
        pressure        : gl.getUniformLocation(pressureShader, 'pressure'),
        resolution      : gl.getUniformLocation(pressureShader, 'resolution'),
        dt              : gl.getUniformLocation(pressureShader, 'dt'),
        h               : gl.getUniformLocation(pressureShader, 'h'),
    };
    const projectUniforms = {
        modelviewMatrix : gl.getUniformLocation(projectShader, 'uModelViewMatrix'),
        velocity        : gl.getUniformLocation(projectShader, 'velocity'),
        pressure        : gl.getUniformLocation(projectShader, 'pressure'),
        resolution      : gl.getUniformLocation(projectShader, 'resolution'),
        dt              : gl.getUniformLocation(projectShader, 'dt'),
        h               : gl.getUniformLocation(projectShader, 'h'),
    };
    const displayUniforms = {
        modelviewMatrix : gl.getUniformLocation(displayShader, 'uModelViewMatrix'),
        texture         : gl.getUniformLocation(displayShader, 'texture'),
        velocity        : gl.getUniformLocation(displayShader, 'velocity'),
        resolution      : gl.getUniformLocation(displayShader, 'resolution'),
    };

    // 頂点バッファの初期化
    // initialize vertex buffer objects
    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    const positions = [
         1.0,  1.0,
        -1.0,  1.0,
         1.0, -1.0,
        -1.0, -1.0,
    ];
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);

    // 座標変換行列の計算
    // calculate the matrices
    const pMatrix = mat4.create();
    mat4.ortho(pMatrix, -1.0, 1.0, -1.0, 1.0, 0.1, 1000.0);
    const mMatrix = mat4.create();
    mat4.translate(mMatrix, mMatrix, [0.0, 0.0, -10.0]);
    const mvpMatrix = mat4.create();
    mat4.multiply(mvpMatrix, pMatrix, mMatrix);
    
    // 速度場の境界条件
    // velocity field boundary conditions
    function velocityBoundary() {
        vFrame = 1 - vFrame;
        gl.bindFramebuffer(gl.FRAMEBUFFER, velocity[vFrame].fb);

        gl.useProgram(boundaryShader);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, velocity[1-vFrame].cb);

        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.enableVertexAttribArray(boundaryAttrib);
        gl.vertexAttribPointer(boundaryAttrib, 2, gl.FLOAT, false, 0, 0);

        gl.uniformMatrix4fv(boundaryUniforms.modelviewMatrix, false, mvpMatrix);
        gl.uniform1i(boundaryUniforms.velocity, 0);
        gl.uniform2f(boundaryUniforms.resolution, frameWidth, frameHeight);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.flush();
    }


    let cap = new cv.VideoCapture(video);

    let oldFrame = new cv.Mat(video.height, video.width, cv.CV_8UC4);
    cap.read(oldFrame);
    let oldGray = new cv.Mat();
    cv.cvtColor(oldFrame, oldGray, cv.COLOR_RGBA2GRAY);

    let frame = new cv.Mat(video.height, video.width, cv.CV_8UC4);
    let frameGray = new cv.Mat();

    let flow = new cv.Mat();
    let flowImage = new cv.Mat(video.height, video.width, cv.CV_8UC4);

    const capTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, capTexture);    
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, frame.data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    
    let flowTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, flowTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, flowImage.data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);

    /*
    const flowSize = new cv.Size(20, 20);

    p0 = [];
    for (let i = 0; i < flowSize.width; i++) {
        for (let j = 0; j < flowSize.height; j++) {
            p0.push(new cv.Point(i * frame.cols / (flowSize.width - 1), j * frame.rows / (flowSize.height - 1)));;
        }
    }
    */

    const text = document.getElementById("text");
    const FPS = 30;
    function processVideo() {
        let begin = Date.now();
        cap.read(frame);
        cv.cvtColor(frame, frameGray, cv.COLOR_RGBA2GRAY);

        cv.calcOpticalFlowFarneback(oldGray, frameGray, flow, 0.5, 3, 15, 3, 5, 1.2, 0);
        //cv.multiply(flow, new cv.Mat(height, width, cv.CV_32FC2, new cv.Scalar(0.1, 0.1)), flow);
        //cv.add(flow, new cv.Mat(height, width, cv.CV_32FC2, new cv.Scalar(0.5, 0.5)), flow);
        flow.convertTo(flow, cv.CV_8U, 10, 127);
        let vec = new cv.MatVector();
        vec.push_back(flow);
        vec.push_back(cv.Mat.zeros(height, width, cv.CV_8UC2));
        cv.merge(vec, flowImage);
        vec.delete();


        // 速度場の計算(1) : 外力項
        // calculate the velocity field (1) : add
        vFrame = 1 - vFrame;
        gl.bindFramebuffer(gl.FRAMEBUFFER, velocity[vFrame].fb);

        gl.useProgram(addShader);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, velocity[1-vFrame].cb);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, flowTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, flowImage.data);

        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.enableVertexAttribArray(addAttrib);
        gl.vertexAttribPointer(addAttrib, 2, gl.FLOAT, false, 0, 0);

        gl.uniformMatrix4fv(addUniforms.modelviewMatrix, false, mvpMatrix);
        gl.uniform1i(addUniforms.velocity, 0);
        gl.uniform1i(addUniforms.texture, 1);
        gl.uniform2f(addUniforms.resolution, frameWidth, frameHeight);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.flush();
        
        velocityBoundary();

        // 速度場の計算(2) : 拡散項
        // calculate the velocity field (1) : diffuse
        vFrame = 1 - vFrame;
        gl.bindFramebuffer(gl.FRAMEBUFFER, velocity[vFrame].fb);

        gl.useProgram(diffuseShader);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, velocity[1-vFrame].cb);

        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.enableVertexAttribArray(diffuseAttrib);
        gl.vertexAttribPointer(diffuseAttrib, 2, gl.FLOAT, false, 0, 0);

        gl.uniformMatrix4fv(diffuseUniforms.modelviewMatrix, false, mvpMatrix);
        gl.uniform1i(diffuseUniforms.texture, 0);
        gl.uniform2f(diffuseUniforms.resolution, frameWidth, frameHeight);
        gl.uniform1f(diffuseUniforms.re, Re);
        gl.uniform1f(diffuseUniforms.dt, dt);
        gl.uniform1f(diffuseUniforms.h, h);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.flush();
        
        velocityBoundary();
        
        // 速度場の計算(3) : 移流項
        // calculate the velosity field (2) : advect
        vFrame = 1 - vFrame;
        gl.bindFramebuffer(gl.FRAMEBUFFER, velocity[vFrame].fb);

        gl.useProgram(advectShader);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, velocity[1-vFrame].cb);
        
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.enableVertexAttribArray(advectAttrib);
        gl.vertexAttribPointer(advectAttrib, 2, gl.FLOAT, false, 0, 0);
        
        gl.uniformMatrix4fv(advectUniforms.modelviewMatrix, false, mvpMatrix);
        gl.uniform1i(advectUniforms.velocity, 0);
        gl.uniform1i(advectUniforms.texture, 0);
        gl.uniform2f(advectUniforms.resolution, frameWidth, frameHeight);
        gl.uniform1f(advectUniforms.dt, dt);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.flush();

        velocityBoundary();
        
        // 圧力場の計算
        // calculate the pressure field
        for (let i = 0; i < steps; i++) {
            pFrame = 1 - pFrame;

            gl.bindFramebuffer(gl.FRAMEBUFFER, pressure[pFrame].fb);

            gl.useProgram(pressureShader);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, velocity[vFrame].cb);
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, pressure[1-pFrame].cb);

            gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
            gl.enableVertexAttribArray(pressureAttrib);
            gl.vertexAttribPointer(pressureAttrib, 2, gl.FLOAT, false, 0, 0);

            gl.uniformMatrix4fv(pressureUniforms.modelviewMatrix, false, mvpMatrix);
            gl.uniform1i(pressureUniforms.velocity, 0);
            gl.uniform1i(pressureUniforms.pressure, 1);
            gl.uniform2f(pressureUniforms.resolution, frameWidth, frameHeight);
            gl.uniform1f(pressureUniforms.dt, dt);
            gl.uniform1f(pressureUniforms.h, h);

            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            gl.flush();
        }

        // 速度場の計算(4) : 圧力項
        // calculate the velocity field (3) : project
        vFrame = 1 - vFrame;
        gl.bindFramebuffer(gl.FRAMEBUFFER, velocity[vFrame].fb);

        gl.useProgram(projectShader);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, velocity[1-vFrame].cb);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, pressure[pFrame].cb);

        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.enableVertexAttribArray(projectAttrib);
        gl.vertexAttribPointer(projectAttrib, 2, gl.FLOAT, false, 0, 0);

        gl.uniformMatrix4fv(projectUniforms.modelviewMatrix, false, mvpMatrix);
        gl.uniform1i(projectUniforms.velocity, 0);
        gl.uniform1i(projectUniforms.pressure, 1);
        gl.uniform2f(projectUniforms.resolution, frameWidth, frameHeight);
        gl.uniform1f(projectUniforms.dt, dt);
        gl.uniform1f(projectUniforms.h, h);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.flush();

        // シーンの描画
        // draw the scene
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.clearColor(0.0, 0.0, 0.0, 1.0);
        gl.clearDepth(1.0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        gl.useProgram(displayShader);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, capTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, frame.data);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, velocity[vFrame].cb);
        
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.enableVertexAttribArray(displayAttrib);
        gl.vertexAttribPointer(displayAttrib, 2, gl.FLOAT, false, 0, 0);

        gl.uniformMatrix4fv(displayUniforms.modelviewMatrix, false, mvpMatrix);
        gl.uniform1i(displayUniforms.texture, 0);
        gl.uniform1i(displayUniforms.velocity, 1);
        gl.uniform2f(displayUniforms.resolution, width, height);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.flush();
        

        /*
        for (let i = 0; i < p0.length; i++) {
            const f = flow.floatPtr(p0[i].y, p0[i].x);
            const p = new cv.Point(p0[i].x + f[0], p0[i].y + f[1]);
            cv.line(frame, p0[i], p, new cv.Scalar(0), 1);
        }
        */


        //cv.imshow("canvasOutput", frame);

        frameGray.copyTo(oldGray);
        // schedule next one.
        let delay = 1000/FPS - (Date.now() - begin);
        setTimeout(processVideo, delay);
    }
    // schedule the first one.
    setTimeout(processVideo, 0);
}

function initFrame(width, height) {
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);

    const cb = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, cb);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, cb, 0);

    const rb = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, width, height);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
    
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    return {fb, cb, rb};
}


function initShader(vertSource, fragSource) {
    const vertShader = gl.createShader(gl.VERTEX_SHADER);
    const fragShader = gl.createShader(gl.FRAGMENT_SHADER);

    gl.shaderSource(vertShader, vertSource);
    gl.shaderSource(fragShader, fragSource);

    gl.compileShader(vertShader);
    gl.compileShader(fragShader);
    
    if (!gl.getShaderParameter(vertShader, gl.COMPILE_STATUS)) {
        alert('An error occurred compiling the vertex shader: ' + gl.getShaderInfoLog(vertShader));
        gl.deleteShader(vertShader);
        return null;
    }

    if (!gl.getShaderParameter(fragShader, gl.COMPILE_STATUS)) {
        alert('An error occurred compiling the fragment shader: ' + gl.getShaderInfoLog(fragShader));
        gl.deleteShader(fragShader);
        return null;
    }
    
    const shaderProgram = gl.createProgram();
    gl.attachShader(shaderProgram, vertShader);
    gl.attachShader(shaderProgram, fragShader);
    gl.linkProgram(shaderProgram);

    return shaderProgram;
}