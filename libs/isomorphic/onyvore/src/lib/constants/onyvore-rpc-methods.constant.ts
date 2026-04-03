export const onyvoreRpcMethods = {
  // Requests
  NOTEBOOK_REGISTER: 'notebook.register',
  NOTEBOOK_UNREGISTER: 'notebook.unregister',
  NOTEBOOK_FILE_EVENT: 'notebook.fileEvent',
  NOTEBOOK_IGNORE_CHANGED: 'notebook.ignoreChanged',
  NOTEBOOK_SEARCH: 'notebook.search',
  NOTEBOOK_GET_LINKS: 'notebook.getLinks',
  NOTEBOOK_GET_NOTEBOOKS: 'notebook.getNotebooks',
  NOTEBOOK_GET_ORPHANS: 'notebook.getOrphans',
  NOTEBOOK_REBUILD: 'notebook.rebuild',
  NOTEBOOK_RECONCILE: 'notebook.reconcile',
  NOTEBOOK_INITIALIZE: 'notebook.initialize',
  // Notifications
  NOTEBOOK_INIT_PROGRESS: 'notebook.initProgress',
  NOTEBOOK_RECONCILE_PROGRESS: 'notebook.reconcileProgress',
  NOTEBOOK_READY: 'notebook.ready',
  NOTEBOOK_INDEX_UPDATED: 'notebook.indexUpdated',
  ACTIVE_NOTEBOOK_CHANGED: 'activeNotebook.changed',
  SEARCH_SHOW: 'search.show',
  // Webview requests
  OPEN_FILE: 'openFile',
  PICK_DIRECTORY: 'pickDirectory',
  GET_ACTIVE_NOTEBOOK: 'getActiveNotebook',
  GET_CONFIGURATION: 'getConfiguration',
  GET_WORKSPACE_FOLDERS: 'getWorkspaceFolders',
} as const;
