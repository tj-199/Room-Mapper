/**
 * Perspective Transform Math Engine
 * Converts 4 source points to 4 destination points into a CSS matrix3d
 */

function solveLinearSystem(A, b) {
    const n = A.length;
    for (let i = 0; i < n; i++) A[i].push(b[i]);
    
    for (let i = 0; i < n; i++) {
        let maxRow = i;
        for (let j = i + 1; j < n; j++) {
            if (Math.abs(A[j][i]) > Math.abs(A[maxRow][i])) maxRow = j;
        }
        
        const temp = A[i];
        A[i] = A[maxRow];
        A[maxRow] = temp;
        
        if (Math.abs(A[i][i]) < 1e-10) return null;
        
        const pivot = A[i][i];
        for (let j = i; j <= n; j++) A[i][j] /= pivot;
        
        for (let j = 0; j < n; j++) {
            if (i !== j) {
                const factor = A[j][i];
                for (let k = i; k <= n; k++) A[j][k] -= factor * A[i][k];
            }
        }
    }
    return A.map(row => row[n]);
}

function getTransformMatrix(src, dst) {
    const a = [], b = [];
    for (let i = 0; i < 4; i++) {
        a.push([src[i].x, src[i].y, 1, 0, 0, 0, -src[i].x*dst[i].x, -src[i].y*dst[i].x]);
        b.push(dst[i].x);
        a.push([0, 0, 0, src[i].x, src[i].y, 1, -src[i].x*dst[i].y, -src[i].y*dst[i].y]);
        b.push(dst[i].y);
    }
    
    const h = solveLinearSystem(a, b);
    if (!h) return null;
    h.push(1); // h33 = 1
    
    // CSS matrix3d format (column-major)
    // [ a b c d ]   [ h0 h1  0 h2 ]
    // [ e f g h ] = [ h3 h4  0 h5 ]
    // [ i j k l ]   [  0  0  1  0 ]
    // [ m n o p ]   [ h6 h7  0 h8 ]
    
    return [
        h[0], h[3], 0, h[6],
        h[1], h[4], 0, h[7],
           0,    0, 1,    0,
        h[2], h[5], 0, h[8]
    ];
}
