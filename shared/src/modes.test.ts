import { describe, it, expect } from 'vitest'
import { ALL_TAGS, MODE_IDS, MODES } from './modes'
import { routerOutputFor, RouterOutput } from './contracts'

const intent = (skillTags: string[]) => ({ type: 'feedback', studentNames: ['Maria'], content: 'x', skillTags, urgency: null, amount: null, minutes: null, attendanceStatus: null, urgent: false })

describe('modes', () => {
  it('ships exactly the three modes, each with 10 unique tags and a label for every tag', () => {
    expect(Object.keys(MODES).sort()).toEqual([...MODE_IDS].sort())
    for (const id of MODE_IDS) {
      const m = MODES[id]
      expect(m.id).toBe(id)
      expect(m.tags).toHaveLength(10)
      expect(new Set(m.tags).size).toBe(10)
      for (const t of m.tags) expect(m.tagLabels[t], `${id}.${t}`).toBeTruthy()
      expect(Object.keys(m.tagLabels).sort()).toEqual([...m.tags].sort())
    }
  })

  it('uses the brief values verbatim for key fields', () => {
    expect(MODES.martial_arts.tags).toEqual(['stance', 'guard', 'kicks', 'strikes', 'forms', 'footwork', 'focus', 'effort', 'respect', 'sparring'])
    expect(MODES.personal_training).toMatchObject({ label: 'Personal training', person: 'client', people: 'clients', recipient: 'client', planUnit: 'Session plan', planItem: 'exercise', weeklyLabel: 'Program block', itemsDueLabel: 'Goals' })
    expect(MODES.personal_training.tagLabels.range).toBe('Range of motion')
    expect(MODES.tutoring).toMatchObject({ recipient: 'parent', planUnit: 'Lesson plan', weeklyLabel: 'Unit', itemsDueLabel: 'Upcoming' })
    expect(MODES.tutoring.tagLabels.concept).toBe('Concept gaps')
    expect(MODES.martial_arts.tagLabels.guard).toBe('Guard drops')
  })

  it('ALL_TAGS is the deduped union', () => {
    const union = new Set(MODE_IDS.flatMap(id => MODES[id].tags))
    expect(ALL_TAGS).toHaveLength(union.size)
    expect(new Set(ALL_TAGS)).toEqual(union)
    expect(ALL_TAGS.filter(t => t === 'effort')).toHaveLength(1)
  })

  it('routerOutputFor only accepts the mode\'s own tags', () => {
    expect(routerOutputFor('personal_training').parse({ intents: [intent(['depth', 'form'])] }).intents).toHaveLength(1)
    expect(() => routerOutputFor('personal_training').parse({ intents: [intent(['guard'])] })).toThrow()
    expect(() => routerOutputFor('martial_arts').parse({ intents: [intent(['depth'])] })).toThrow()
    expect(() => routerOutputFor('tutoring').parse({ intents: [intent(['stance'])] })).toThrow()
    expect(() => routerOutputFor('tutoring').parse({ intents: [intent(['procedure', 'focus', 'effort'])] })).toThrow()
    // transport schema accepts any short tag string
    expect(RouterOutput.parse({ intents: [intent(['depth'])] }).intents[0]!.skillTags).toEqual(['depth'])
  })
})
