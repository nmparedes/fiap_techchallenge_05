import { LoginError, type AuthGateway, type LoginCredentials } from './auth-client.js';
import { DashboardController, type DashboardGateway } from './dashboard.js';
import { SessionStore, type SessionChangeReason, type UserSession } from './session.js';
import { createTooltipControl, TooltipController } from './tooltip.js';
import { VIDEO_ACCEPT_VALUE } from './upload-validation.js';

function createTemplate(markup: string): HTMLElement {
  const template = document.createElement('template');
  template.innerHTML = markup.trim();
  return template.content.firstElementChild as HTMLElement;
}

export function createAsciiRule(): HTMLDivElement {
  const rule = document.createElement('div');
  rule.className = 'ascii-rule';
  rule.setAttribute('aria-hidden', 'true');
  rule.textContent = '+--------------------------------------------------------------+';
  return rule;
}

export function createLoginPanel(message = ''): HTMLElement {
  const panel = createTemplate(`
    <section class="panel login-panel" aria-labelledby="login-title">
      <div class="panel-kicker">ESTADO 01 / VISITANTE</div>
      <h2 id="login-title" class="panel-title">+--[ ACESSO RESTRITO ]--+</h2>
      <p class="panel-copy">Entre para acompanhar seus processamentos.</p>
      <form class="login-form" aria-label="Formulário de acesso" novalidate>
        <div class="field">
          <div class="field-heading">
            <label for="login-username">Usuário</label>
            <span data-tooltip-slot="username"></span>
          </div>
          <input id="login-username" name="username" minlength="3" maxlength="64" autocomplete="username" aria-describedby="username-tooltip login-message" required />
        </div>
        <div class="field">
          <div class="field-heading">
            <label for="login-password">Senha</label>
            <span data-tooltip-slot="password"></span>
          </div>
          <input id="login-password" name="password" type="password" maxlength="128" autocomplete="current-password" aria-describedby="password-tooltip login-message" required />
        </div>
        <button class="button button-primary login-submit" type="submit">[ ENTRAR ]</button>
      </form>
      <p id="login-message" class="login-message" role="status" aria-live="polite" aria-atomic="true"></p>
    </section>
  `);
  const messageElement = panel.querySelector('.login-message') as HTMLParagraphElement;
  messageElement.textContent = message;
  panel
    .querySelector('[data-tooltip-slot="username"]')
    ?.replaceWith(
      createTooltipControl(
        'username-tooltip',
        'usuário',
        'Use o nome de usuário fornecido para sua conta.',
      ),
    );
  panel
    .querySelector('[data-tooltip-slot="password"]')
    ?.replaceWith(
      createTooltipControl(
        'password-tooltip',
        'senha',
        'Digite a senha da sua conta. Ela permanecerá oculta.',
      ),
    );
  return panel;
}

export function createUploadPanel(): HTMLElement {
  const panel = createTemplate(`
    <section class="panel upload-panel" aria-labelledby="upload-title">
      <div class="panel-kicker">ENVIO AUTENTICADO</div>
      <h2 id="upload-title" class="panel-title">+--[ NOVO PROCESSAMENTO ]--+</h2>
      <form class="upload-form" aria-label="Enviar vídeo" novalidate>
        <div class="field file-field">
          <div class="field-heading">
            <label for="upload-video">Arquivo de vídeo</label>
            <span data-tooltip-slot="video"></span>
          </div>
          <input id="upload-video" name="video" type="file" accept="${VIDEO_ACCEPT_VALUE}" aria-describedby="video-tooltip upload-status" required />
        </div>
        <div class="field fps-field">
          <div class="field-heading">
            <label for="upload-fps">Imagens por segundo</label>
            <span data-tooltip-slot="fps"></span>
          </div>
          <input id="upload-fps" name="fps" type="number" value="1" min="1" max="10" step="1" inputmode="numeric" aria-describedby="fps-tooltip upload-status" required />
        </div>
        <button class="button button-primary upload-submit" type="submit">[ ENVIAR VÍDEO ]</button>
      </form>
      <p id="upload-status" class="upload-status" role="status" aria-live="polite" aria-atomic="true">Aguardando seleção.</p>
    </section>
  `);
  panel
    .querySelector('[data-tooltip-slot="video"]')
    ?.replaceWith(
      createTooltipControl(
        'video-tooltip',
        'arquivo de vídeo',
        'Escolha MP4, AVI, MOV, MKV, WMV, FLV ou WebM com até 200 MiB.',
      ),
    );
  panel
    .querySelector('[data-tooltip-slot="fps"]')
    ?.replaceWith(
      createTooltipControl(
        'fps-tooltip',
        'imagens por segundo',
        'Define quantas imagens são extraídas por segundo. Use um número inteiro de 1 a 10; o padrão é 1.',
      ),
    );
  return panel;
}

export function createVideosPanel(): HTMLElement {
  return createTemplate(`
    <section class="panel videos-panel" aria-labelledby="videos-title">
      <div class="section-heading">
        <div>
          <div class="panel-kicker">CATÁLOGO DO USUÁRIO</div>
          <h2 id="videos-title" class="panel-title">+--[ MEUS VÍDEOS ]--+</h2>
        </div>
        <span class="badge badge-processing refresh-countdown" aria-live="off">ATUALIZAÇÃO 3s</span>
      </div>
      <div class="videos-content"><p class="empty-state">Carregando vídeos...</p></div>
    </section>
  `);
}

export function createNotificationsPanel(): HTMLElement {
  return createTemplate(`
    <aside class="panel notifications-panel" aria-labelledby="notifications-title">
      <div class="panel-kicker">CANAL INTERNO</div>
      <h2 id="notifications-title" class="panel-title">+--[ NOTIFICAÇÕES ]--+</h2>
      <div class="notifications-content"><p class="empty-state">Carregando notificações...</p></div>
    </aside>
  `);
}

export function createAuthenticatedPanel(session: UserSession): HTMLElement {
  const greeting = session.user?.displayName ?? 'Sessão restaurada';
  const panel = createTemplate(`
    <section class="authenticated-view" aria-labelledby="workspace-title">
      <div class="session-bar">
        <div>
          <span class="status-dot" aria-hidden="true"></span>
          <span>ESTADO 02 / SESSÃO ATIVA</span>
        </div>
        <div class="session-user">
          <span>Olá, <strong class="session-display-name"></strong></span>
          <span class="badge badge-completed">AUTENTICADO</span>
          <button class="button button-danger button-compact logout-button" type="button">[ SAIR ]</button>
        </div>
      </div>
      <h2 id="workspace-title" class="visually-hidden">Painel autenticado</h2>
      <p class="dashboard-status" role="status" aria-live="polite" aria-atomic="true">Sincronizando painel...</p>
      <div class="authenticated-grid"></div>
    </section>
  `);
  const grid = panel.querySelector('.authenticated-grid') as HTMLDivElement;
  const displayName = panel.querySelector('.session-display-name') as HTMLElement;
  displayName.textContent = greeting;
  grid.append(createUploadPanel(), createNotificationsPanel(), createVideosPanel());
  return panel;
}

export function createAppView(session: UserSession | null, message = ''): HTMLElement {
  const shell = createTemplate(`
    <main class="app-shell">
      <section class="terminal-window" aria-label="Interface FIAP X">
        <header class="app-header">
          <div>
            <p class="eyebrow">[ PROCESSAMENTO SEGURO DE VÍDEOS ]</p>
            <h1>[ FIAP X :: TERMINAL DE QUADROS ]</h1>
          </div>
          <div class="header-stamp" aria-label="Estado da aplicação">
            <span>PAINEL_0.3</span>
            <span>SERVIÇOS CONECTADOS</span>
          </div>
        </header>
        <div class="screen-layout"></div>
        <footer class="app-footer">
          <span class="system-status"></span>
          <span>AUTH · VÍDEOS · NOTIFICAÇÕES</span>
        </footer>
      </section>
    </main>
  `);
  const terminalWindow = shell.querySelector('.terminal-window') as HTMLElement;
  const layout = shell.querySelector('.screen-layout') as HTMLDivElement;
  const systemStatus = shell.querySelector('.system-status') as HTMLSpanElement;
  terminalWindow.insertBefore(createAsciiRule(), terminalWindow.querySelector('.app-header'));
  terminalWindow.insertBefore(createAsciiRule(), layout);

  if (session === null) {
    layout.classList.add('screen-layout-login');
    layout.append(createLoginPanel(message));
    systemStatus.textContent = 'SISTEMA> aguardando autenticação.';
  } else {
    layout.classList.add('screen-layout-authenticated');
    layout.append(createAuthenticatedPanel(session));
    systemStatus.textContent = 'SISTEMA> painel autenticado ativo.';
  }

  terminalWindow.insertBefore(createAsciiRule(), terminalWindow.querySelector('.app-footer'));
  return shell;
}

export class Application {
  private feedback = '';
  private loginPending = false;
  private dashboardController: DashboardController | null = null;
  private tooltipController: TooltipController | null = null;
  private unsubscribeSession: (() => void) | null = null;

  public constructor(
    private readonly root: HTMLElement,
    private readonly authGateway: AuthGateway,
    private readonly sessionStore: SessionStore,
    private readonly dashboardGateway?: DashboardGateway,
  ) {}

  public mount(): void {
    this.sessionStore.restore();
    this.unsubscribeSession = this.sessionStore.subscribe((_session, reason) =>
      this.handleSessionChange(reason),
    );
    this.render();
  }

  public unmount(): void {
    this.dashboardController?.destroy();
    this.tooltipController?.destroy();
    this.dashboardController = null;
    this.tooltipController = null;
    this.unsubscribeSession?.();
    this.unsubscribeSession = null;
    this.root.replaceChildren();
  }

  private render(): void {
    this.dashboardController?.destroy();
    this.tooltipController?.destroy();
    this.dashboardController = null;
    this.tooltipController = null;
    this.root.replaceChildren(createAppView(this.sessionStore.current, this.feedback));
    this.tooltipController = new TooltipController(this.root);
    this.tooltipController.start();
    const session = this.sessionStore.current;

    if (session === null) {
      const form = this.root.querySelector<HTMLFormElement>('.login-form');
      form?.addEventListener('submit', (event) => void this.handleLogin(event, form));
      form
        ?.querySelector<HTMLButtonElement>('.login-submit')
        ?.addEventListener('click', (event) => void this.handleLogin(event, form));
      form?.addEventListener('input', () => {
        form.querySelectorAll<HTMLInputElement>('input').forEach((input) => {
          input.removeAttribute('aria-invalid');
        });
        this.feedback = '';
        const message = form.parentElement?.querySelector<HTMLElement>('.login-message');

        if (message !== null && message !== undefined) {
          message.textContent = '';
        }
      });
      return;
    }

    const logoutButton = this.root.querySelector<HTMLButtonElement>('.logout-button');
    logoutButton?.addEventListener('click', () => this.sessionStore.clear('logout'));

    if (this.dashboardGateway !== undefined) {
      const dashboardRoot = this.root.querySelector<HTMLElement>('.authenticated-view');

      if (dashboardRoot !== null) {
        this.dashboardController = new DashboardController(
          dashboardRoot,
          this.dashboardGateway,
          session.accessToken,
        );
        this.dashboardController.mount();
      }
    }
  }

  private async handleLogin(event: Event, form: HTMLFormElement): Promise<void> {
    event.preventDefault();

    if (this.loginPending) {
      return;
    }

    const formData = new FormData(form);
    const credentials: LoginCredentials = {
      username: String(formData.get('username') ?? ''),
      password: String(formData.get('password') ?? ''),
    };

    const invalidField = this.findInvalidLoginField(credentials);

    if (invalidField !== null) {
      this.feedback =
        invalidField === 'username'
          ? 'Informe um usuário com pelo menos 3 caracteres.'
          : 'Informe sua senha.';
      form.querySelector<HTMLInputElement>(`input[name="${invalidField}"]`)?.focus();
      form.querySelectorAll<HTMLInputElement>('input').forEach((input) => {
        if (input.name === invalidField) {
          input.setAttribute('aria-invalid', 'true');
        } else {
          input.removeAttribute('aria-invalid');
        }
      });
      form.parentElement?.querySelector<HTMLElement>('.login-message')?.replaceChildren(this.feedback);
      return;
    }

    this.setLoginPending(form, true);

    try {
      const loginData = await this.authGateway.login(credentials);
      form.reset();
      this.sessionStore.start(loginData);
    } catch (error) {
      const credentialsRejected = error instanceof LoginError && error.kind === 'credentials';
      this.feedback = credentialsRejected
        ? 'Usuário ou senha inválidos.'
        : 'Não foi possível entrar agora. Tente novamente.';
      this.setLoginPending(form, false);

      if (credentialsRejected) {
        form.querySelectorAll<HTMLInputElement>('input').forEach((input) => {
          input.setAttribute('aria-invalid', 'true');
        });
        form.querySelector<HTMLInputElement>('input[name="username"]')?.focus();
      }
    }
  }

  private setLoginPending(form: HTMLFormElement, pending: boolean): void {
    this.loginPending = pending;
    form.setAttribute('aria-busy', String(pending));
    form
      .querySelectorAll<HTMLInputElement | HTMLButtonElement>('input, button')
      .forEach((control) => {
        control.disabled = pending;
      });
    const button = form.querySelector<HTMLButtonElement>('.login-submit');
    const message = form.parentElement?.querySelector<HTMLElement>('.login-message');

    if (button !== null) {
      button.textContent = pending ? '[ ENTRANDO... ]' : '[ ENTRAR ]';
    }

    if (message !== null && message !== undefined) {
      message.textContent = pending ? 'Validando credenciais...' : this.feedback;
    }
  }

  private findInvalidLoginField(credentials: LoginCredentials): 'username' | 'password' | null {
    if (credentials.username.trim().length < 3) {
      return 'username';
    }

    return credentials.password === '' ? 'password' : null;
  }

  private handleSessionChange(reason: SessionChangeReason): void {
    this.loginPending = false;

    if (reason === 'unauthorized') {
      this.feedback = 'Sua sessão expirou. Entre novamente.';
    } else if (reason === 'logout') {
      this.feedback = 'Sessão encerrada.';
    } else {
      this.feedback = '';
    }

    this.render();
  }
}
