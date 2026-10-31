export type RepoInfo = {
  branch: string
  repo: string
  top: string
  worktree: string | null
}

export type BranchInfo = RepoInfo | null

declare module 'claude-code' {
  interface PluginState {
    'branch-band': { info: BranchInfo; touched: RepoInfo[]; hidden: boolean }
  }
}
