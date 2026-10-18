import { useState } from 'react'
import type { AgentTask } from '@matside/shared'
import type { Api } from '../core/api'
import { AgentRunDetailView } from './AgentRunDetail'
import { AgentsTiles } from './AgentsTiles'
import { AgentTopic } from './AgentTopic'

type View = { page: 'tiles' } | { page: 'topic'; task: AgentTask } | { page: 'run'; id: string; task: AgentTask; fromTopic: boolean }

export function Agents({ api }: { api: Api }) {
  const [view, setView] = useState<View>({ page: 'tiles' })
  if (view.page === 'run') {
    const back = () => setView(view.fromTopic ? { page: 'topic', task: view.task } : { page: 'tiles' })
    return <AgentRunDetailView api={api} id={view.id} onBack={back} backLabel={view.fromTopic ? 'Back' : 'Agents'} />
  }
  if (view.page === 'topic') {
    return <AgentTopic api={api} task={view.task} onBack={() => setView({ page: 'tiles' })} onOpenRun={id => setView({ page: 'run', id, task: view.task, fromTopic: true })} />
  }
  return <AgentsTiles api={api} onOpenTopic={task => setView({ page: 'topic', task })} onOpenRun={(id, task) => setView({ page: 'run', id, task, fromTopic: false })} />
}
