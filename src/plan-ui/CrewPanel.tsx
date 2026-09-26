import { crew } from '../lib/crew'
import type { PlanView, StageStatus } from './planState'

// One card per crew member. Cards light up while their member works.

const statusLabel: Record<StageStatus, string> = {
  waiting: 'Waiting',
  working: 'Working',
  done: 'Done',
  error: 'Stopped',
}

export function CrewPanel({ view }: { view: PlanView }) {
  return (
    <ol className="crew">
      {crew.map((member) => {
        const stage = view.stages[member.id]
        return (
          <li key={member.id} className={`crew-card is-${stage.status}`}>
            <div className="crew-head">
              <span className="crew-name">{member.name}</span>
              <span className={`crew-type${member.ai ? ' is-ai' : ''}`}>{member.ai ? 'AI agent' : 'Code'}</span>
              <span className="crew-status">
                <span className="crew-dot" aria-hidden="true" />
                {statusLabel[stage.status]}
              </span>
            </div>
            <p className="crew-message">{stage.message || member.job}</p>

            {member.id === 'verifier' && view.rejected.length > 0 && (
              <details className="crew-details">
                <summary>{view.rejected.length} picks dropped</summary>
                <ul>
                  {view.rejected.map((r) => (
                    <li key={`${r.title}:${r.reason}`}>
                      <strong>{r.title}</strong>: {r.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {member.id === 'critic' && view.issues.length > 0 && (
              <ul className="crew-issues">
                {view.issues.map((issue, i) => (
                  <li key={i}>
                    <span className="crew-target">To the {issue.target === 'scout' ? 'Scout' : 'Timekeeper'}:</span>{' '}
                    {issue.complaint}
                  </li>
                ))}
              </ul>
            )}
          </li>
        )
      })}
    </ol>
  )
}
