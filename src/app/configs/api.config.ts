const SERVER_URL: string = 'http://114.132.150.141:8001';
const SERVER_API_URL: string = 'http://114.132.150.141:8000';
// const SERVER_API_URL: string = 'http://127.0.0.1:8000';

export const API = {
  projectList: `${SERVER_URL}/-/verdaccio/data/packages`,
  projectSearch: `${SERVER_URL}/-/v1/search`,
  // auth
  login: `${SERVER_URL}/api/v1/auth/login`,
  register: `${SERVER_URL}/api/v1/auth/register`,
  logout: `${SERVER_URL}/api/v1/auth/logout`,
  verifyToken: `${SERVER_URL}/api/v1/auth/verify`,
  refreshToken: `${SERVER_URL}/api/v1/auth/refresh`,
  me: `${SERVER_URL}/api/v1/auth/me`,
  // ai
  startSession: `${SERVER_API_URL}/api/v1/start_session`,
  closeSession: `${SERVER_API_URL}/api/v1/close_session`,
  streamConnect: `${SERVER_API_URL}/api/v1/stream`,
  sendMessage: `${SERVER_API_URL}/api/v1/send_message`,
  getHistory: `${SERVER_API_URL}/api/v1/conversation_history`,
  stopSession: `${SERVER_API_URL}/api/v1/stop_session`,
  cancelTask: `${SERVER_API_URL}/api/v1/cancel_task`,
};
