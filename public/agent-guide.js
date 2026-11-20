const stages = [
  {
    title: 'User question', icon: 'people', tone: 'source',
    detail: 'The user selects the published agent in Microsoft 365 Copilot and asks a business question.',
    label: 'Example prompt',
    example: 'Which territories had the highest sales last quarter, and what was each territory’s share of total sales?'
  },
  {
    title: 'Instructions & skills', icon: 'pen', tone: 'rules',
    detail: 'The configured instructions define source selection, metric conventions and response requirements. Relevant skills provide task-specific guidance.',
    label: 'Configured guidance',
    example: 'Use the approved sales source. Compare the last complete quarter. Calculate share against all eligible territories, not just the displayed rows.'
  },
  {
    title: 'Power BI action', icon: 'source', tone: 'source',
    detail: 'The agent calls Fabric IQ’s AskPowerBI action with the selected source ID, question and context. Data access uses the current user’s Power BI permissions.',
    label: 'Data request',
    example: 'Retrieve a territory ranking and the overall sales denominator from the configured report or semantic model.'
  },
  {
    title: 'Response', icon: 'file', tone: 'expertise',
    detail: 'Copilot uses the action’s results and configured response instructions to produce an answer. Its underlying models and orchestration are provided by Microsoft.',
    label: 'Expected format',
    example: 'A territory ranking with sales, share of total, the reporting period and a source reference. Check the results against known answers.'
  }
];

let sequence = 0;

export function defineAgentGuide(icon) {
  customElements.define('agent-guide', class extends HTMLElement {
    constructor() {
      super();
      this.guideId = `agent-guide-${++sequence}`;
      this.step = 0;
      this.playing = false;
      this.onClick = event => {
        const button = event.target.closest('button');
        if (!button || !this.contains(button)) return;
        if (button.hasAttribute('data-guide-play')) this.playing ? this.pause() : this.play();
        if (button.hasAttribute('data-guide-step')) this.select(Number(button.dataset.guideStep));
      };
      this.onKeydown = event => {
        if (!event.target.matches('[data-guide-step]')) return;
        const index = Number(event.target.dataset.guideStep);
        const next = {
          ArrowRight: (index + 1) % stages.length, ArrowDown: (index + 1) % stages.length,
          ArrowLeft: (index + stages.length - 1) % stages.length, ArrowUp: (index + stages.length - 1) % stages.length,
          Home: 0, End: stages.length - 1
        }[event.key];
        if (next === undefined) return;
        event.preventDefault();
        this.select(next);
        this.querySelector(`[data-guide-step="${next}"]`).focus();
      };
      this.onHidden = () => { if (document.hidden) this.pause(); };
      this.onClose = () => this.pause();
    }

    connectedCallback() {
      this.innerHTML = `<section class="agent-guide" aria-labelledby="${this.guideId}-title">
        <header class="guide-heading"><span class="eyebrow">About declarative agents</span>
          <h2 id="${this.guideId}-title">What is a declarative agent?</h2>
          <p>A task-specific configuration of Microsoft 365 Copilot. You supply instructions, knowledge sources and actions; Microsoft provides the underlying models and orchestration.</p>
          <p>Use one to apply the same business context across conversations, instead of including it in every prompt. This app configures Power BI sources, instructions and skills, then publishes the agent for use in Copilot.</p>
        </header>
        <div class="guide-inputs">
          <div class="tone-source"><span class="feature-icon">${icon('source')}</span><div><h3>Power BI sources</h3><p>Specify the reports and semantic models the agent should use.</p></div></div>
          <div class="tone-rules"><span class="feature-icon">${icon('pen')}</span><div><h3>Business instructions</h3><p>Define metric conventions, date rules and response requirements.</p></div></div>
          <div class="tone-expertise"><span class="feature-icon">${icon('book')}</span><div><h3>Reusable skills</h3><p>Configure procedures for rankings, variances and period comparisons.</p></div></div>
        </div>
        <div class="guide-walkthrough">
          <div class="guide-walkthrough-heading"><div><h3>Example: a Power BI question</h3><p>Illustration only. No live queries or results.</p></div><button type="button" class="btn small" data-guide-play>Play example</button></div>
          <div class="guide-track" role="tablist" aria-label="Example stages">${stages.map((stage, index) => `<button type="button" role="tab" class="guide-step tone-${stage.tone}" id="${this.guideId}-step-${index}" data-guide-step="${index}" aria-controls="${this.guideId}-panel" aria-selected="${index === this.step}" tabindex="${index === this.step ? 0 : -1}"><span class="guide-step-icon">${icon(stage.icon)}</span><span><small>${index + 1}</small>${stage.title}</span></button>`).join('')}</div>
          <div class="guide-detail" id="${this.guideId}-panel" role="tabpanel" tabindex="0">
            <div class="guide-explanation" aria-live="polite" aria-atomic="true"><span class="eyebrow" data-guide-position></span><h4 data-guide-title></h4><p data-guide-detail></p></div>
            <div class="guide-example"><span data-guide-label></span><p data-guide-example></p></div>
          </div>
        </div>
        <footer class="guide-footer"><p>Configuration does not train a new model or grant data access. Licensing and tenant policies still apply. Validate the agent’s answers against known results.</p><a href="https://learn.microsoft.com/plugins/overview-declarative-agent" target="_blank" rel="noopener noreferrer">Microsoft documentation ${icon('arrow')}</a></footer>
      </section>`;
      this.addEventListener('click', this.onClick);
      this.addEventListener('keydown', this.onKeydown);
      document.addEventListener('visibilitychange', this.onHidden);
      this.dialog = this.closest('dialog');
      this.dialog?.addEventListener('close', this.onClose);
      this.update();
    }

    disconnectedCallback() {
      this.pause();
      this.removeEventListener('click', this.onClick);
      this.removeEventListener('keydown', this.onKeydown);
      document.removeEventListener('visibilitychange', this.onHidden);
      this.dialog?.removeEventListener('close', this.onClose);
    }

    select(index) {
      if (!Number.isInteger(index) || index < 0 || index >= stages.length) return;
      this.pause();
      this.step = index;
      this.update();
    }

    play() {
      if (this.step === stages.length - 1) this.step = 0;
      this.playing = true;
      this.update();
      this.schedule();
    }

    schedule() {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        if (!this.isConnected || this.dialog?.open === false || this.step === stages.length - 1) return this.pause();
        this.step++;
        this.update();
        this.schedule();
      }, 3500);
    }

    pause() {
      clearTimeout(this.timer);
      this.playing = false;
      if (this.isConnected) this.update();
    }

    update() {
      const stage = stages[this.step];
      this.querySelector('.agent-guide').classList.toggle('is-playing', this.playing);
      for (const button of this.querySelectorAll('[data-guide-step]')) {
        const selected = Number(button.dataset.guideStep) === this.step;
        button.setAttribute('aria-selected', String(selected));
        button.tabIndex = selected ? 0 : -1;
      }
      this.querySelector('[data-guide-position]').textContent = `Step ${this.step + 1} of ${stages.length}`;
      this.querySelector('[data-guide-title]').textContent = stage.title;
      this.querySelector('[data-guide-detail]').textContent = stage.detail;
      this.querySelector('[data-guide-label]').textContent = stage.label;
      this.querySelector('[data-guide-example]').textContent = stage.example;
      this.querySelector('.guide-detail').setAttribute('aria-labelledby', `${this.guideId}-step-${this.step}`);
      this.querySelector('[data-guide-play]').textContent = this.playing ? 'Pause example' : this.step === stages.length - 1 ? 'Replay example' : 'Play example';
    }
  });
}
