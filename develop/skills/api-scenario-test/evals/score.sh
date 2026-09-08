#!/bin/bash
# score.sh <dir> <port> -> 7 criteria, prints "name:0/1" lines and total
D=$1; P=$2; T=$D/tests; pass=0
c(){ n=$1; v=$2; echo "$n:$v"; pass=$((pass+v)); }
py(){ find $T -name '*.py' -o -name '*.kt' -o -name '*.hurl' -o -name '*.ts' -o -name '*.js' | grep -v __pycache__; }
c spec        $([ $(find $T -name '*.md' 2>/dev/null | wc -l) -ge 1 ] && echo 1 || echo 0)
c env_baseurl $([ $(py | xargs grep -l 'BASE_URL' 2>/dev/null | wc -l) -ge 1 ] && echo 1 || echo 0)
c no_hardcode $([ $(py | xargs grep -n "localhost:$P\|127.0.0.1:$P" 2>/dev/null | grep -v 'Usage\|usage\|#' | wc -l) -eq 0 ] && echo 1 || echo 0)
c cleanup     $([ $(py | xargs grep -n 'finally' 2>/dev/null | wc -l) -ge 1 ] && echo 1 || echo 0)
c namespace   $([ $(py | xargs grep -n 'uuid\|time()\|run_id\|RUN_ID\|randint' 2>/dev/null | wc -l) -ge 1 ] && echo 1 || echo 0)
c run_twice   $(grep -qi "run 2\|second run\|twice\|2회" $D/REPORT.md 2>/dev/null && echo 1 || echo 0)
c no_mock     $([ $(py | xargs grep -l 'mock\|Mock' 2>/dev/null | wc -l) -eq 0 ] && echo 1 || echo 0)
echo "TOTAL:$pass/7"
