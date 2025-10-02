const WebSocket = require('ws');

const REST_URL = 'https://api.bybit.com/v5/market/instruments-info?category=linear';
const WS_URL   = 'wss://stream.bybit.com/v5/public/linear';

// Получаем список символов
async function getSymbols() {
  const res = await fetch(REST_URL);
  const js = await res.json();
  return js.result.list
    .filter(it =>
      it.quoteCoin === 'USDT' &&
      it.contractType === 'LinearPerpetual' &&
      it.status === 'Trading'
    )
    .map(it => it.symbol);
}

async function main() {
  const symbols = await getSymbols();
  console.log('Нашли символов:', symbols.length);

  const ws = new WebSocket(WS_URL);

  ws.on('open', () => {
    console.log('WS открыт');
    // подписываемся на все тикеры
    const args = symbols.map(sym => `tickers.${sym}`);
    // можно батчами, если список очень длинный
    ws.send(JSON.stringify({ op: 'subscribe', args }));
  });

  ws.on('message', msg => {
    const data = JSON.parse(msg);
    if (data.topic && data.topic.startsWith('tickers.') && data.data.lastPrice) {
      console.log('Обновление:', data.data.symbol, data.data.lastPrice);
    }
  });

  ws.on('error', err => console.error('Ошибка WS:', err));
}

main();
