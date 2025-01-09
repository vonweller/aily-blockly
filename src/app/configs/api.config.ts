// const SERVER_URL: string = "http://localhost:8000";
const SERVER_URL: string = 'https://registry.openjumper.cn';

export const API = {
  projectList: `${SERVER_URL}/-/verdaccio/data/packages`,
  projectSearch: `${SERVER_URL}/-/v1/search`,
};
