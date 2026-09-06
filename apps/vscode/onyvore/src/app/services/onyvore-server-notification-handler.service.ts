import { Injectable, Inject, OnModuleDestroy } from '@nestjs/common';
import { ServerNotificationHandler, VSCODE_API, VscodeApi } from '@onivoro/server-vscode';
import { onyvoreRpcMethods } from '@onivoro/isomorphic-onyvore';
import { NotebookDiscoveryService } from './notebook-discovery.service';

interface ProgressParams {
  notebookId: string;
  processed: number;
  total: number;
  progress: number;
}

interface RunningTask {
  /** Resolves when the notebook reports ready, ending the progress task. */
  finish: () => void;
  report: (params: ProgressParams, verb: string) => void;
  lastPercent: number;
}

/**
 * Surfaces server progress in the UI.
 *
 * Progress arrives as a stream of updates ending in `notebook.ready`, so it maps
 * onto a single `withProgress` task per notebook rather than the transient
 * status-bar messages this used to post — those expired on a timer, flickering
 * during long builds and vanishing while work was still running.
 */
@Injectable()
export class OnyvoreServerNotificationHandlerService implements OnModuleDestroy {
  private tasks = new Map<string, RunningTask>();

  constructor(
    @Inject(VSCODE_API) private readonly vscode: VscodeApi,
    private readonly notebookDiscovery: NotebookDiscoveryService,
  ) {}

  onModuleDestroy(): void {
    for (const task of this.tasks.values()) task.finish();
    this.tasks.clear();
  }

  @ServerNotificationHandler(onyvoreRpcMethods.NOTEBOOK_INIT_PROGRESS)
  handleInitProgress(params: ProgressParams): void {
    this.track(params, 'Indexing');
  }

  @ServerNotificationHandler(onyvoreRpcMethods.NOTEBOOK_RECONCILE_PROGRESS)
  handleReconcileProgress(params: ProgressParams): void {
    this.track(params, 'Updating');
  }

  @ServerNotificationHandler(onyvoreRpcMethods.NOTEBOOK_READY)
  handleNotebookReady(params: { notebookId: string }): void {
    this.tasks.get(params.notebookId)?.finish();
    this.tasks.delete(params.notebookId);
  }

  @ServerNotificationHandler(onyvoreRpcMethods.NOTEBOOK_INDEX_UPDATED)
  handleIndexUpdated(): void {
    // Auto-broadcast to the webview by the framework; nothing to do here.
  }

  private track(params: ProgressParams, verb: string): void {
    const task = this.tasks.get(params.notebookId) ?? this.start(params.notebookId);
    task.report(params, verb);
  }

  private start(notebookId: string): RunningTask {
    const vs = this.vscode as any;
    const name = this.notebookDiscovery.getNotebook(notebookId)?.name ?? 'notebook';

    let finish: () => void = () => undefined;
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });

    const task: RunningTask = {
      finish: () => finish(),
      lastPercent: 0,
      report: () => undefined,
    };

    vs.window.withProgress(
      {
        location: vs.ProgressLocation.Window,
        title: `Onyvore: ${name}`,
      },
      (progress: any) => {
        task.report = (params, verb) => {
          // withProgress increments are relative, so send only the delta.
          const increment = Math.max(0, params.progress - task.lastPercent);
          task.lastPercent = params.progress;
          progress.report({
            increment,
            message: `${verb} ${params.processed}/${params.total}`,
          });
        };
        return done;
      },
    );

    this.tasks.set(notebookId, task);
    return task;
  }
}
