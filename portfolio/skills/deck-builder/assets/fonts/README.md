# Bundled fonts

NanumSquare, NanumSquareRound and NanumSquare Neo by NAVER Corporation (designed by Sandoll),
under the SIL Open Font License 1.1 — see `OFL.txt`. Every static weight, TTF only (the OTF
copies and the Neo variable font are left out; same glyphs).

`deck.py` measures with these before fontconfig (`find_font`), and `render` shows them to
LibreOffice (a private fontconfig file locally, a read-only mount in docker).

Source, downloaded 2026-10-14 from Naver's official distribution:

- https://hangeul.pstatic.net/hangeul_static/webfont/zips/nanum-square.zip
- https://hangeul.pstatic.net/hangeul_static/webfont/zips/nanum-square-round.zip
- https://hangeul.pstatic.net/hangeul_static/webfont/zips/nanum-square-neo.zip (`TTF/`)

| file | sha256 |
|---|---|
| NanumSquare_acB.ttf | 1a266ecb0450fcdd0c7659090b8be784a2029a2f78a4a9501de3394ee284864d |
| NanumSquare_acEB.ttf | 5348d0f43d0b1d01e6ac888aafba2048178adc2304dbc5c8f4b3418438f02554 |
| NanumSquare_acL.ttf | 046cb1b1a4666e9a01ec09bc6109d32194351df18668709a3469967e50587372 |
| NanumSquare_acR.ttf | a8c3aa53d5dbab550e7784281801f71f7af54619ca8d33a6e5e7d34d4f06d7e2 |
| NanumSquareB.ttf | f737d58294faec9c632189af3a2a3e48e49c03c0256de09db61e879e2857bfbf |
| NanumSquareEB.ttf | 6608adc320ff8514630d04a53e16cc7a5d54f5cbdbe3769109f311dcb3b48f80 |
| NanumSquareL.ttf | b2f68affc8b5d450fd0cb1b6f1523888a70e236fff942889c30f832727152da4 |
| NanumSquareR.ttf | 5a51deae5237435d9a0bc0cc6cc30619a914b29801f895698cfdacadcad06e94 |
| NanumSquareNeo-aLt.ttf | 1b9af8b2f1a60c35a12f1fd59d99d5fdf9bf970ebdf08221ee247e7c16fc1d06 |
| NanumSquareNeo-bRg.ttf | 864de849b9d0af7efbd9e855044f5ab3bbf44cc88ddff6b9873ee830b9d3a61f |
| NanumSquareNeo-cBd.ttf | 4749fa5691157cf56a59d297b45e88894a646846048018cd7a4117ffb2869767 |
| NanumSquareNeo-dEb.ttf | 3cedb3ee07aabd894f2c1ad4f0434739ecf28a870674ba73cff016057c764750 |
| NanumSquareNeo-eHv.ttf | a2850a335d3211ef19b130d368c961ea11822b67e2b7332bd2de78a486f69005 |
| NanumSquareRoundB.ttf | 61fd37816a1ee1a9336876742392d80bdafd340e5124a088aeda20446e2e15de |
| NanumSquareRoundEB.ttf | 9e845fc35c5bc4a5b7ed59d85a1760059de5ce55b5e5a4d7535f7efa87695e39 |
| NanumSquareRoundL.ttf | b0bd9e7e067840d55520ce7e45a3e57327144da136b4ab558fb98b200701d071 |
| NanumSquareRoundR.ttf | 52862fdf05b55ba886ca21998222d9598ef84c975e68046b9a8d8f1af09228a0 |
