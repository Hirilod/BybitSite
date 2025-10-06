import redis

KEY = "market:index:candles:h1"
r = redis.Redis(host="localhost", port=7000, db=0)

# синхронное удаление
r.unlink(KEY, 1, 0)  # оставит пустой список (валидный трюк)
