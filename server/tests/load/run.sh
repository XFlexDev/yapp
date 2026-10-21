#!/bin/bash
# Isolated load test: throwaway DB on :8599, no replica/storage/push env, same binary as prod.
set -e
N=${1:-500}; SECS=${2:-90}; D=/tmp/yapload
rm -rf $D; mkdir -p $D/av
SECRET=$(openssl rand -hex 32)
env -i PATH=$PATH RUST_LOG=warn YAP_JWT_SECRET=$SECRET LIVEKIT_API_KEY=lt LIVEKIT_API_SECRET=$(openssl rand -hex 32) LIVEKIT_URL=wss://lt.invalid \
  YAP_BIND=127.0.0.1:8599 YAP_DB=$D/db.sqlite3 YAP_AVATAR_DIR=$D/av BIN=${BIN:-/opt/yap/yap-server} bash -c 'ulimit -n 16384; exec ${BIN:-/opt/yap/yap-server}' > $D/server.log 2>&1 &
PID=$!
trap "kill $PID 2>/dev/null; rm -rf $D" EXIT
sleep 2
node -e '
const n=+process.argv[1], id=(i)=>`lt${String((i+n)%n).padStart(4,"0")}`, t=Date.now(); let s="BEGIN;";
for(let i=0;i<n;i++) s+=`INSERT INTO users(id,email,username,display_name,created_at) VALUES("${id(i)}","${id(i)}@load.test","${id(i)}","Load ${i}",${t});`;
for(let i=0;i<n;i++) for(let k=1;k<=5;k++){const [a,b]=[id(i),id(i+k)].sort(); s+=`INSERT OR IGNORE INTO friendships(a,b,created_at) VALUES("${a}","${b}",${t});`;}
console.log(s+"COMMIT;")' $N | sqlite3 $D/db.sqlite3
ulimit -n 16384
node "$(dirname "$0")/load.mjs" http://127.0.0.1:8599 $SECRET $PID $N $SECS
grep -ciE "error|panic" $D/server.log | sed 's/^/server log error lines: /' || true
