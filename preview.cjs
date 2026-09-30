// Compatibility entry point: the cabinet now needs its local data API.
'use strict';
const {createServer}=require('./server.cjs');
const port=Number(process.env.PORT)||4173;
createServer().listen(port,'127.0.0.1',()=>console.log(`Local: http://127.0.0.1:${port}`));
