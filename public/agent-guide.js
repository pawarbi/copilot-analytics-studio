const stages = [
  {
    title: 'User question', icon: 'people', tone: 'source',
    detail: 'The user selects the published agent in Microsoft 365 Copilot and asks a business question.',
    label: 'Example prompt',
    example: 'How did sales, gross margin and order backlog change last quarter?'
  },
  {
    title: 'Instructions & skills', icon: 'pen', tone: 'rules',
    detail: 'The configured instructions define source selection, metric conventions and response requirements. Relevant skills provide task-specific guidance.',
    label: 'Configured guidance',
    example: 'Use the configured sources and governed metrics. Compare the last complete quarter. Apply the relevant comparison skill and identify the reporting period.'
  },
  {
    title: 'Power BI action', icon: 'source', tone: 'source',
    detail: 'The agent selects relevant configured artifacts and calls Fabric IQ’s AskPowerBI action. Reports use their underlying semantic models; a configured model can also be queried directly. Existing Power BI permissions apply.',
    label: 'Data request',
    example: 'The three branches show an example source configuration, not three mandatory queries. Report-to-model arrows show the underlying data relationships.'
  },
  {
    title: 'Response', icon: 'file', tone: 'expertise',
    detail: 'Copilot composes the answer using results from the selected artifacts, guided by the instructions and relevant skills. The data comes from Power BI, not just the model’s general knowledge.',
    label: 'Expected format',
    example: 'A comparison of sales, gross margin and backlog, with the reporting period and source references. Validate the figures against known results.'
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
        <div class="guide-walkthrough">
          <div class="guide-walkthrough-heading"><div><h3>How a request uses your selected data</h3><p>Example configuration. No live queries or results.</p></div><button type="button" class="btn small" data-guide-play>Play example</button></div>
          <div class="grounding-map" role="group" aria-label="Request flows through agent guidance to three Power BI reports and their semantic models, then to a grounded answer">
            <svg class="flow-connections" aria-hidden="true" focusable="false"></svg>
            <div class="flow-node flow-request tone-source" data-flow-node="request" data-flow-stage="0">
              <span class="flow-node-icon">${icon('people')}</span><strong>Request</strong><p>How did sales, margin and backlog change last quarter?</p>
            </div>
            <div class="flow-node flow-agent tone-rules" data-flow-node="agent" data-flow-stage="1">
              <span class="flow-node-label">Declarative agent</span><strong>Instructions + skills</strong>
              <span class="flow-guidance">${icon('pen')}<span>Sources, metrics<br>and date rules</span></span>
              <span class="flow-guidance">${icon('book')}<span>Comparison and<br>analysis procedures</span></span>
            </div>
            <div class="flow-artifacts">
              <div class="flow-artifacts-title"><img src="/icons/power_bi_32_color.svg" width="20" height="20" alt="">Selected Power BI artifacts</div>
              <span class="flow-column-label flow-reports-label">Reports</span><span class="flow-column-label flow-models-label">Semantic models</span>
              ${['Sales', 'Finance', 'Operations'].map((name, index) => `
                <div class="flow-node flow-report flow-row-${index} tone-source" data-flow-node="report-${index}" data-flow-stage="2"><img src="/icons/report_32_item.svg" width="28" height="28" alt="Power BI report"><strong>${name}</strong><span>Report</span></div>
                <div class="flow-node flow-model flow-row-${index} tone-source" data-flow-node="model-${index}" data-flow-stage="2"><img src="/icons/semantic_model_32_item.svg" width="28" height="28" alt="Power BI semantic model"><strong>${name}</strong><span>Semantic model</span></div>`).join('')}
            </div>
            <div class="flow-node flow-answer tone-expertise" data-flow-node="answer" data-flow-stage="3">
              <span class="flow-node-icon">${icon('file')}</span><strong>Answer</strong><p>Figures, reporting period and source references</p><span class="flow-answer-source">${icon('check')}Selected data</span>
            </div>
          </div>
          <p class="flow-grounding-note">${icon('source')}<span>The selected artifacts supply the data. Instructions and skills guide retrieval and the response. Only relevant sources are queried.</span></p>
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
      this.resizeObserver = new ResizeObserver(() => this.drawConnections());
      this.resizeObserver.observe(this.querySelector('.grounding-map'));
      this.update();
    }

    disconnectedCallback() {
      this.pause();
      this.removeEventListener('click', this.onClick);
      this.removeEventListener('keydown', this.onKeydown);
      document.removeEventListener('visibilitychange', this.onHidden);
      this.dialog?.removeEventListener('close', this.onClose);
      this.resizeObserver?.disconnect();
    }

    drawConnections() {
      const map = this.querySelector('.grounding-map');
      const bounds = map.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      const vertical = getComputedStyle(map).getPropertyValue('--flow-vertical').trim() === '1';
      const point = (name, side) => {
        const box = map.querySelector(`[data-flow-node="${name}"]`).getBoundingClientRect();
        return {
          x: (side === 'left' ? box.left : side === 'right' ? box.right : box.left + box.width / 2) - bounds.left,
          y: (side === 'top' ? box.top : side === 'bottom' ? box.bottom : box.top + box.height / 2) - bounds.top
        };
      };
      const connect = (from, to, stage, phase = '') => {
        let a = point(from, 'right'), b = point(to, 'left'), d;
        if (!vertical) {
          const middle = (a.x + b.x) / 2;
          d = `M ${a.x} ${a.y} C ${middle} ${a.y}, ${middle} ${b.y}, ${b.x} ${b.y}`;
        } else if (from === 'request') {
          a = point(from, 'bottom'); b = point(to, 'top');
          d = `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
        } else if (from === 'agent') {
          a = point(from, 'bottom');
          const turn = a.y + 20;
          d = `M ${a.x} ${a.y} V ${turn} H 3 V ${b.y} H ${b.x}`;
        } else if (to === 'answer') {
          b = point(to, 'top');
          d = `M ${a.x} ${a.y} H ${bounds.width - 3} V ${b.y - 20} H ${b.x} V ${b.y}`;
        } else {
          d = `M ${a.x} ${a.y} H ${b.x}`;
        }
        return { stage, phase, d };
      };
      const edges = [connect('request', 'agent', 0)];
      for (let index = 0; index < 3; index++) {
        edges.push(connect('agent', `report-${index}`, 1));
        edges.push(connect(`report-${index}`, `model-${index}`, 2, 'read'));
        edges.push(connect(`model-${index}`, 'answer', 2, 'return'));
      }
      const svg = map.querySelector('.flow-connections');
      svg.setAttribute('viewBox', `0 0 ${bounds.width} ${bounds.height}`);
      svg.innerHTML = `<defs><marker id="${this.guideId}-arrow" viewBox="0 0 8 8" refX="8" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 1 1 L 7 4 L 1 7" class="flow-arrowhead"/></marker></defs>${edges.map(edge => `<g class="flow-edge ${edge.phase}" data-flow-stage="${edge.stage}"><path class="flow-wire" d="${edge.d}" marker-end="url(#${this.guideId}-arrow)"/><circle class="flow-dot" r="4"/></g>`).join('')}`;
      svg.querySelectorAll('.flow-dot').forEach((dot, index) => { dot.style.offsetPath = `path("${edges[index].d}")`; });
      this.updateFlow();
    }

    updateFlow() {
      for (const element of this.querySelectorAll('[data-flow-stage]')) {
        element.classList.toggle('is-active', Number(element.dataset.flowStage) === this.step);
        element.classList.toggle('is-complete', Number(element.dataset.flowStage) < this.step);
      }
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
      this.updateFlow();
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
