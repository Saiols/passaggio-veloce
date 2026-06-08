// jscanify build browser (export "./client" → src/jscanify.js): UMD senza tipi.
// Usato via dynamic import nel DocumentScannerModal; le API (findPaperContour/
// getCornerPoints/extractPaper) sono richiamate su `any`.
declare module 'jscanify/client';
