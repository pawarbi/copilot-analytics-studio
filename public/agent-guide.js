const stages = [
  {
    title: 'User question', icon: 'people', tone: 'source',
    detail: 'The user selects the published agent in Microsoft Copilot and asks a business question.',
    label: 'Example prompt',
    example: 'How did sales change last quarter?'
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
    example: 'This example routes one request to the Sales report and its semantic model. Finance and Operations remain available but are not used for this question.'
  },
  {
    title: 'Response', icon: 'file', tone: 'expertise',
    detail: 'Copilot composes the answer using results from the selected artifacts, guided by the instructions and relevant skills. The data comes from Power BI, not just the model’s general knowledge.',
    label: 'Expected format',
    example: 'A sales comparison with the reporting period and a reference to the Sales source. Validate the figures against known results.'
  }
];

const sources = [
  { title: 'Fabric IQ overview', url: 'https://learn.microsoft.com/fabric/iq/overview' },
  { title: 'Fabric IQ in Microsoft Copilot', url: 'https://learn.microsoft.com/fabric/iq/connectors/microsoft-365-copilot-overview' },
  { title: 'Declarative agents', url: 'https://learn.microsoft.com/plugins/overview-declarative-agent' },
  { title: 'Fabric data agent concepts', url: 'https://learn.microsoft.com/fabric/data-science/concept-data-agent' },
  { title: 'Data agent sources and configuration', url: 'https://learn.microsoft.com/fabric/data-science/data-agent-add-datasources' },
  { title: 'Publish a data agent to Microsoft Copilot', url: 'https://learn.microsoft.com/fabric/data-science/data-agent-microsoft-365-copilot' }
];

const differences = [
  {
    title: 'Agent definition', sources: [2, 3],
    here: 'A declarative agent package for Microsoft Copilot. This app configures its instructions, skills and Fabric IQ action; Microsoft Copilot provides the models and orchestration.',
    dataAgent: 'A data agent item configured in a Fabric workspace, with its own data sources and instructions for conversational data analysis.'
  },
  {
    title: 'Data coverage', sources: [1, 4],
    here: 'Power BI reports and semantic models selected by URL. This app does not configure direct lakehouse, warehouse or KQL connections.',
    dataAgent: 'Multiple Fabric source types, including lakehouses, warehouses, SQL and mirrored databases, KQL databases and Power BI semantic models.'
  },
  {
    title: 'Query workflow', sources: [1, 3],
    here: 'Copilot calls the Fabric IQ AskPowerBI action. A report can provide context for answering over its underlying semantic model; a model can also be targeted directly.',
    dataAgent: 'The data agent selects a configured source, generates and validates a source-specific read query, then executes it. Core query languages include SQL, DAX and KQL.'
  },
  {
    title: 'Customization', sources: [2, 4],
    here: 'Core Copilot instructions, source-specific guidance and reusable SKILL.md procedures, packaged with the declarative agent.',
    dataAgent: 'Agent instructions, schema selection and source-specific configuration. SQL and KQL sources support example question/query pairs. Semantic model guidance uses Prep for AI; example query pairs are not configured on that source in the data agent.'
  },
  {
    title: 'Publishing and use', sources: [3, 5],
    here: 'FIDA publishes personal or shareable agents to Microsoft Copilot with Agents Toolkit and exports project/package ZIPs. It does not create or publish a Fabric data agent item.',
    dataAgent: 'Publish and share the Fabric item, optionally publish it to the Microsoft Copilot Agent Store, or integrate it with Copilot Studio and Foundry. It is not limited to the Fabric chat experience.'
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
          <p>A task-specific configuration of Microsoft Copilot. You supply instructions, knowledge sources and actions; Microsoft provides the underlying models and orchestration.</p>
          <p>Use one to apply the same business context across conversations, instead of including it in every prompt. This app configures Power BI sources, instructions and skills, then publishes the agent for use in Copilot. Data answering is powered by Fabric IQ.</p>
        </header>
        <div class="guide-walkthrough">
          <div class="guide-walkthrough-heading"><div><h3>How a request uses your selected data</h3><p>Example configuration. No live queries or results.</p></div><button type="button" class="btn small" data-guide-play>Play example</button></div>
          <div class="grounding-map" role="group" aria-label="One request follows agent guidance to the Sales report and semantic model, then to a grounded answer. Two other report and model pairs remain available.">
            <svg class="flow-connections" aria-hidden="true" focusable="false"></svg>
            <div class="flow-node flow-request tone-source" data-flow-node="request" data-flow-stage="0">
              <span class="flow-node-icon">${icon('people')}</span><strong>Request</strong><p>How did sales change last quarter?</p>
            </div>
            <div class="flow-node flow-agent tone-rules" data-flow-node="agent" data-flow-stage="1">
              <span class="flow-node-label">Declarative agent</span><strong>Instructions + skills</strong>
              <span class="flow-guidance">${icon('pen')}<span>Sources, metrics<br>and date rules</span></span>
              <span class="flow-guidance">${icon('book')}<span>Comparison and<br>analysis procedures</span></span>
            </div>
            <div class="flow-artifacts">
              <div class="flow-artifacts-title"><img src="/icons/fabric_32_color.svg" width="24" height="24" alt="Microsoft Fabric"><span><strong>Fabric IQ</strong><small>Data answers over selected Power BI artifacts</small></span></div>
              <span class="flow-column-label flow-reports-label">Reports</span><span class="flow-column-label flow-models-label">Semantic models</span>
              ${['Sales', 'Finance', 'Operations'].map((name, index) => `
                <div class="flow-node flow-report flow-row-${index} tone-source" data-flow-node="report-${index}" data-flow-stage="2" data-flow-route="${index === 0}"><img src="/icons/report_32_item.svg" width="28" height="28" alt="Power BI report"><strong>${name}</strong><span>Report</span></div>
                <div class="flow-node flow-model flow-row-${index} tone-source" data-flow-node="model-${index}" data-flow-stage="2" data-flow-route="${index === 0}"><img src="/icons/semantic_model_32_item.svg" width="28" height="28" alt="Power BI semantic model"><strong>${name}</strong><span>Semantic model</span></div>`).join('')}
            </div>
            <div class="flow-node flow-answer tone-expertise" data-flow-node="answer" data-flow-stage="3">
              <span class="flow-node-icon"><img src="/icons/copilot_32_color.svg" width="32" height="32" alt="Microsoft Copilot"></span><strong>Copilot answer</strong><p>Figures, reporting period and source references</p><span class="flow-answer-source">${icon('check')}Sales model</span>
            </div>
          </div>
          <p class="flow-grounding-note">${icon('source')}<span>One request follows the Sales route in this example. The other configured sources remain available. Instructions and skills guide retrieval and the response.</span></p>
          <div class="guide-track" role="tablist" aria-label="Example stages">${stages.map((stage, index) => `<button type="button" role="tab" class="guide-step tone-${stage.tone}" id="${this.guideId}-step-${index}" data-guide-step="${index}" aria-controls="${this.guideId}-panel" aria-selected="${index === this.step}" tabindex="${index === this.step ? 0 : -1}"><span class="guide-step-icon">${icon(stage.icon)}</span><span><small>${index + 1}</small>${stage.title}</span></button>`).join('')}</div>
          <div class="guide-detail" id="${this.guideId}-panel" role="tabpanel" tabindex="0">
            <div class="guide-explanation" aria-live="polite" aria-atomic="true"><span class="eyebrow" data-guide-position></span><h4 data-guide-title></h4><p data-guide-detail></p></div>
            <div class="guide-example"><span data-guide-label></span><p data-guide-example></p></div>
          </div>
        </div>
        <footer class="guide-footer"><p>Configuration does not train a new model or grant data access. Licensing and tenant policies still apply. Validate the agent’s answers against known results.</p><a href="https://learn.microsoft.com/plugins/overview-declarative-agent" target="_blank" rel="noopener noreferrer">Microsoft documentation ${icon('arrow')}</a></footer>
        <section class="agent-comparison" aria-labelledby="${this.guideId}-comparison-title">
          <header class="comparison-heading"><span class="eyebrow">Choosing an approach</span><h2 id="${this.guideId}-comparison-title">How is this different from Fabric Data Agent?</h2>
            <p>FIDA builds a declarative agent that uses Fabric IQ for Power BI data answers. Fabric Data Agent is a separate Fabric item, also part of Fabric IQ. Both can be used from Microsoft Copilot. <a href="${sources[0].url}" target="_blank" rel="noopener noreferrer" aria-label="Fabric IQ overview, comparison source 1">[1]</a></p>
          </header>
          <ol class="comparison-list">${differences.map((difference, index) => `<li>
            <h3><span class="comparison-number" aria-hidden="true">0${index + 1}</span>${difference.title}<span class="comparison-citations">${difference.sources.map(source => `<a href="${sources[source].url}" target="_blank" rel="noopener noreferrer" aria-label="${sources[source].title}, source for ${difference.title.toLowerCase()}">[${source + 1}]</a>`).join(' ')}</span></h3>
            <div class="comparison-pair"><div><h4>Agent built with this app</h4><p>${difference.here}</p></div><div><h4>Fabric Data Agent</h4><p>${difference.dataAgent}</p></div></div>
          </li>`).join('')}</ol>
          <p class="comparison-scope">This comparison describes this app's current Fabric IQ MCP integration, not every declarative agent. Both approaches use the requesting user's data permissions; publishing an agent does not grant access to its underlying sources.</p>
          <footer class="comparison-references"><span>Microsoft Learn sources · Reviewed 19 November 2026</span><div>${sources.map((source, index) => `<a href="${source.url}" target="_blank" rel="noopener noreferrer">[${index + 1}] ${source.title} ${icon('arrow')}</a>`).join('')}</div></footer>
        </section>
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
      const connect = (from, to, stage, onRoute = true) => {
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
        return { stage, onRoute, d };
      };
      const edges = [connect('request', 'agent', 0)];
      for (let index = 0; index < 3; index++) {
        edges.push(connect('agent', `report-${index}`, 1, index === 0));
        edges.push(connect(`report-${index}`, `model-${index}`, 2, index === 0));
        edges.push(connect(`model-${index}`, 'answer', 2, index === 0));
      }
      this.routePaths = [edges[0].d, edges[1].d, `${edges[2].d} ${edges[3].d.replace(/^M /, 'L ')}`];
      const svg = map.querySelector('.flow-connections');
      svg.setAttribute('viewBox', `0 0 ${bounds.width} ${bounds.height}`);
      svg.innerHTML = `<defs><marker id="${this.guideId}-arrow" viewBox="0 0 8 8" refX="8" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 1 1 L 7 4 L 1 7" class="flow-arrowhead"/></marker></defs>${edges.map(edge => `<g class="flow-edge" data-flow-stage="${edge.stage}" data-flow-route="${edge.onRoute}"><path class="flow-wire" d="${edge.d}" marker-end="url(#${this.guideId}-arrow)"/></g>`).join('')}`;
      this.updateFlow();
    }

    updateFlow() {
      for (const element of this.querySelectorAll('[data-flow-stage]')) {
        const onRoute = element.dataset.flowRoute !== 'false';
        element.classList.toggle('is-active', onRoute && Number(element.dataset.flowStage) === this.step);
        element.classList.toggle('is-complete', onRoute && Number(element.dataset.flowStage) < this.step);
      }
      const svg = this.querySelector('.flow-connections');
      const previous = svg.querySelector('.flow-dot');
      if (this.routePaths && previous?.dataset.step !== String(this.step)) {
        const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        dot.setAttribute('class', `flow-dot${this.step === stages.length - 1 ? ' is-arrived' : ''}`);
        dot.setAttribute('r', '4');
        dot.dataset.step = String(this.step);
        dot.style.offsetPath = `path("${this.routePaths[Math.min(this.step, 2)]}")`;
        if (previous) previous.replaceWith(dot);
        else svg.append(dot);
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
