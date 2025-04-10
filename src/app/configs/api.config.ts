// const SERVER_URL: string = "http://localhost:8000";
const SERVER_URL: string = '';
const SERVER_API_URL: string = '';

export const API = {
  projectList: `${SERVER_URL}/-/verdaccio/data/packages`,
  projectSearch: `${SERVER_URL}/-/v1/search`,
  chatSSE: `${SERVER_API_URL}/api/v1/chat`,
};
