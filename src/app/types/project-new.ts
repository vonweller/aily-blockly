export interface NewProjectData {
  name: string;
  path: string;
  board: {
    name: string;
    nickname: string;
    version: string;
    localSource?: string;
  };
  devmode?: string;
}
