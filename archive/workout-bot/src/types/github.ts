export interface GitHubFileContent {
  name: string;
  path: string;
  sha: string;
  content: string;
  encoding: 'base64';
  size: number;
  url: string;
  html_url: string;
  git_url: string;
  download_url: string | null;
  type: 'file';
}

export interface GitHubDirectoryItem {
  name: string;
  path: string;
  sha: string;
  size: number;
  url: string;
  html_url: string;
  git_url: string;
  download_url: string | null;
  type: 'file' | 'dir';
}

export interface GitHubCreateFileParams {
  message: string;
  content: string;
  branch?: string;
}

export interface GitHubUpdateFileParams extends GitHubCreateFileParams {
  sha: string;
}

export interface GitHubCreateFileResponse {
  content: GitHubFileContent;
  commit: {
    sha: string;
    message: string;
    html_url: string;
  };
}

export interface GitHubTreeItem {
  path: string;
  mode: string;
  type: 'blob' | 'tree';
  sha: string;
  size?: number;
  url: string;
}

export interface GitHubTree {
  sha: string;
  url: string;
  tree: GitHubTreeItem[];
  truncated: boolean;
}

export interface GitHubApiError {
  message: string;
  documentation_url?: string;
  errors?: Array<{
    resource: string;
    code: string;
    field: string;
    message?: string;
  }>;
}
