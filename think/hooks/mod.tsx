import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Snap } from '../types'
import { byPersona, newest, page, parse, summarize } from './debate'

// Read only: the think:brainstorming skill writes the debate log; the mod never writes it.
const snap = atom({ plugin: 'think', key: 'snap' } as const, null as Snap | null)
const view = atom({ plugin: 'think', key: 'view' } as const, 'timeline' as 'timeline' | 'options' | 'result')
const filter = atom({ plugin: 'think', key: 'filter' } as const, null as string | null)
const offset = atom({ plugin: 'think', key: 'offset' } as const, 0)
const lang = atom({ plugin: 'think', key: 'lang' } as const, 'en' as 'en' | 'ko')
const seen = atom({ plugin: 'think', key: 'seen' } as const, [] as string[])

const PANE = 'brainstorming-status'
const OPEN = { id: PANE, title: 'Brainstorming', focus: true, closeOnEscape: true } as const
const DIR = '.claude/brainstorming'
const MAX_BYTES = 4 * 1024 * 1024
const LIVE_MS = 30 * 60 * 1000
const TICK_MS = 3000
const ROWS = 12

const en = {
  tabTimeline: 'Timeline', tabOptions: 'Options', tabResult: 'Result',
  band: 'Brainstorming · {phase}/3 · speaking: {who}', bandIdle: 'Brainstorming · {phase}/3',
  speaking: 'Speaking now: {who}', ended: 'Debate ended', all: 'All', close: 'close',
  noLog: 'No debate log in this folder (.claude/brainstorming).', tooBig: 'This debate log is too large to show.',
  forAgainst: '+{pros} / −{cons}', cutBy: 'cut: {why}', noOptions: 'No options yet.', noResult: 'No result yet.',
  fallback: 'Fell back to normal mode', card: 'Brainstorming · debate ended', open: 'Open', dismiss: 'Dismiss',
  cmdDesc: 'Open the brainstorming debate pane', opened: 'pane opened', closed: 'pane closed',
}

export const STRINGS: Record<'en' | 'ko', Record<keyof typeof en, string>> = {
  en,
  ko: {
    tabTimeline: '타임라인', tabOptions: '옵션', tabResult: '결과',
    band: '브레인스토밍 · {phase}/3 · 발언 중: {who}', bandIdle: '브레인스토밍 · {phase}/3',
    speaking: '발언 중: {who}', ended: '토론 끝', all: '전체', close: '닫기',
    noLog: '이 폴더에 토론 로그가 없습니다 (.claude/brainstorming).', tooBig: '토론 로그가 너무 커서 보여줄 수 없습니다.',
    forAgainst: '찬 {pros} / 반 {cons}', cutBy: '탈락: {why}', noOptions: '아직 옵션이 없습니다.', noResult: '아직 결과가 없습니다.',
    fallback: '일반 모드로 전환됨', card: '브레인스토밍 · 토론 끝', open: '열기', dismiss: '닫기',
    cmdDesc: '브레인스토밍 토론 창 열기', opened: '창을 열었습니다', closed: '창을 닫았습니다',
  },
}
type Key = keyof typeof en

const fmt = (text: string, vars: Record<string, string | number> = {}) => text.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''))
const isKorean = (language: unknown) => typeof language === 'string' && /^(ko|korean|한국어)/i.test(language)

export const register: Register = on => {
  let isRunning = false

  on('session.start', async ($, e, next) => {
    if ((await $.session.surfaces()).length === 0) return next(e)
    const startMs = await $.clock.now()

    async function tick() {
      if (isRunning) return
      isRunning = true
      try {
        const prev = await read($, snap)
        let entries: { name: string; kind: string; size: number; mtimeMs: number }[]
        try {
          entries = await $.fs.list(DIR)
        } catch {
          if (prev !== null) await update($, snap, () => null)
          return
        }
        const f = newest(entries)
        if (f === undefined) {
          if (prev !== null) await update($, snap, () => null)
          return
        }
        if (prev !== null && prev.slug === f.name && prev.mtimeMs === f.mtimeMs && prev.size === f.size) {
          const live = !prev.debate.ended && (await $.clock.now()) - f.mtimeMs <= LIVE_MS
          if (live !== prev.live) await update($, snap, () => ({ ...prev, live }))
          return
        }
        if (f.size > MAX_BYTES) return
        let body: string
        try {
          body = await $.fs.read(`${DIR}/${f.name}`)
        } catch {
          return // the last good view stays
        }
        const debate = summarize(parse(body))
        const live = !debate.ended && (await $.clock.now()) - f.mtimeMs <= LIVE_MS
        await update($, snap, () => ({ slug: f.name, debate, mtimeMs: f.mtimeMs, size: f.size, live, fresh: f.mtimeMs >= startMs }))
      } catch {
        // fail open: the last view stays
      } finally {
        isRunning = false
      }
    }

    try {
      const language = (await $.settings.read()).language
      await update($, lang, () => (isKorean(language) ? 'ko' : 'en'))
    } catch {
      // English
    }
    await $.command.register({ name: PANE, description: STRINGS[await read($, lang)].cmdDesc })
    await tick()
    $.clock.every(TICK_MS, tick)
    return next(e)
  })

  // the command toggles: open, or close when already open
  on('command.run', { command: PANE }, async $ => {
    const s = STRINGS[await read($, lang)]
    if ((await $.ui.panes()).some(p => p.id === PANE)) {
      await $.ui.close({ id: PANE })
      return { text: s.closed }
    }
    await $.ui.open(OPEN)
    return { text: s.opened }
  })

  // ↑↓ move the timeline's own window
  on('ui.scroll', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if ((await read($, view)) !== 'timeline') return next(e)
    await update($, offset, o => Math.max(0, o + e.by))
    return {}
  }).catch(($, e, next) => next(e))

  // Tab onto a persona chip filters by it
  on('ui.focus', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    const el = e.element
    if (typeof el === 'string' && el.startsWith('who:')) {
      const who = el.slice(4)
      await update($, filter, () => (who === '' ? null : who))
      await update($, offset, () => 0)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const lang$ = await read($, lang)
    const s = (k: Key, v?: Record<string, string | number>) => fmt(STRINGS[lang$][k], v)
    const kind = await read($, view)
    const sn = await read($, snap)
    const closeBtn = <Button key="close" plain hotkey="q" label={s('close')} onPress={() => $.ui.close({ id: PANE })} />
    if (sn === null) return <Box flexDirection="column"><Text>{s('noLog')}</Text>{closeBtn}</Box>
    const d = sn.debate
    const items = [{ key: 'timeline', label: s('tabTimeline') }, { key: 'options', label: s('tabOptions') }, { key: 'result', label: s('tabResult') }]

    let body
    if (kind === 'timeline') {
      const who = await read($, filter)
      const lines = byPersona(d.lines, who)
      const win = page(lines, await read($, offset), ROWS)
      const chips = [null, ...d.personas]
      body = (
        <Box flexDirection="column">
          <Box columnGap={2}>
            {chips.map(p => (
              <Button key={`who:${p ?? ''}`} plain dimColor={who !== p} label={`${who === p ? '● ' : ''}${p ?? s('all')}`}
                onPress={async () => { await update($, filter, () => p); await update($, offset, () => 0) }} />
            ))}
          </Box>
          <Box flexDirection="column" marginTop={1}>
            {win.items.map((l, i) => (
              // one plain span per line: a nested span split a wide first glyph on the terminal
              <Text key={`l${win.offset + i}`} wrap="truncate-end" color={l.persona === d.speaking ? 'claude' : undefined}>
                {`r${l.round} ${l.persona} · ${l.kind}${l.to ? ` → ${l.to}` : ''}: ${l.text}`}
              </Text>
            ))}
          </Box>
          {lines.length > ROWS && <Text dimColor>{`${win.offset + 1}-${win.offset + win.items.length}/${lines.length}`}</Text>}
        </Box>
      )
    } else if (kind === 'options') {
      body = d.options.length === 0 ? <Text dimColor>{s('noOptions')}</Text> : (
        <Box flexDirection="column">
          {d.options.map(o => (
            <Box key={o.id} flexDirection="column">
              <Box>
                <Box flexShrink={1}><Text wrap="truncate-end" dimColor={o.cut !== null}>{`${o.id} ${o.title}`}</Text></Box>
                <Box flexShrink={0} marginLeft={2}><Text color={o.pros >= o.cons ? 'success' : 'warning'}>{s('forAgainst', { pros: o.pros, cons: o.cons })}</Text></Box>
              </Box>
              {o.cut !== null && <Text color="error" wrap="truncate-end">{`  ${s('cutBy', { why: o.cut })}`}</Text>}
            </Box>
          ))}
        </Box>
      )
    } else {
      body = d.result === null ? <Text dimColor>{s('noResult')}</Text> : (
        <Box flexDirection="column">
          {d.fallback && <Text color="warning">{s('fallback')}</Text>}
          <Text>{d.result}</Text>
        </Box>
      )
    }
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1}>
        <Box>
          <Box flexShrink={1} flexGrow={1}><Text bold wrap="truncate-end">{sn.slug.replace(/\.jsonl$/, '')}</Text></Box>
          <Box flexShrink={0} marginLeft={2}><Text color={d.ended ? 'success' : 'claude'}>{d.ended ? s('ended') : d.speaking ? s('speaking', { who: d.speaking }) : `${d.phase}/3`}</Text></Box>
          <Box flexShrink={0} marginLeft={2}>{closeBtn}</Box>
        </Box>
        <Box marginY={1}>
          {/* a tab that does not fit moves whole to the next line, never splits */}
          <Box columnGap={2} flexWrap="wrap">
            {items.map((t, i) => (
              <Box key={`tab-${t.key}`} flexShrink={0}><Button key={t.key} plain hotkey={String(i + 1)} dimColor={kind !== t.key} label={`${kind === t.key ? '● ' : ''}${t.label}`}
                onPress={() => update($, view, () => t.key as 'timeline' | 'options' | 'result')} /></Box>
            ))}
          </Box>
        </Box>
        {body}
      </Box>
    )
  })

  // band while a debate is live; one end card after a debate this session saw finish
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const sn = await read($, snap)
    if (sn === null) return next(e)
    const lang$ = await read($, lang)
    const s = (k: Key, v?: Record<string, string | number>) => fmt(STRINGS[lang$][k], v)
    const d = sn.debate
    const { Box, Text, Button } = $.ui.resolve(e)
    if (sn.live) {
      return (
        <Box flexDirection="column">
          <Box>
            <Box flexShrink={1}><Text dimColor wrap="truncate-end">{d.speaking ? s('band', { phase: d.phase, who: d.speaking }) : s('bandIdle', { phase: d.phase })}</Text></Box>
            <Box flexShrink={0} marginLeft={1}><Button key="open" label={s('open')} onPress={() => $.ui.open(OPEN)} /></Box>
          </Box>
          {await next(e)}
        </Box>
      )
    }
    if (d.ended && sn.fresh && !(await read($, seen)).includes(sn.slug)) {
      const done = () => update($, seen, l => [...l, sn.slug])
      return (
        <Box flexDirection="column">
          <Box>
            <Box flexShrink={0}><Text bold color={d.fallback ? 'warning' : 'success'}>{d.fallback ? `${s('card')} · ${s('fallback')}` : s('card')}</Text></Box>
            {d.result && <Box flexShrink={1} marginLeft={1}><Text dimColor wrap="truncate-end">{`— ${d.result}`}</Text></Box>}
            <Box flexShrink={0} marginLeft={1}><Button key="result" label={s('open')} onPress={async () => { await done(); await update($, view, () => 'result'); await $.ui.open(OPEN) }} /></Box>
            <Box flexShrink={0} marginLeft={1}><Button key="dismiss" label={s('dismiss')} onPress={done} /></Box>
          </Box>
          {await next(e)}
        </Box>
      )
    }
    return next(e)
  })
}
