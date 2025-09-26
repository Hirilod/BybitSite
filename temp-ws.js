const WebSocket = require('ws');
const ws = new WebSocket('wss://stream.bybit.com/v5/public/linear');
ws.on('open', () => {
  console.log('open');
  ws.send(JSON.stringify({ op: 'subscribe', args: ['kline.1.BTCUSDT'] }));
});
ws.on('message', (data) => {
  console.log(data.toString());
});
ws.on('error', (err) => console.error('error', err));
