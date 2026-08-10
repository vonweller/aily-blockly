export interface NewProjectData {
  name: string;
  path: string;
  projectType?: 'blockly' | 'python';
  board: {
    name: string;
    nickname: string;
    version: string;
  };
  devmode?: string;
  python?: {
    runtime?: string;
    adapter?: string;
    entry?: string;
  };
}
