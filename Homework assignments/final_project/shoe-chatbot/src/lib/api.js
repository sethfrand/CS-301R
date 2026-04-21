import axios from "axios";
import { API_BASE_URL } from "./constants";

export function createApiClient(token) {
  return axios.create({
    baseURL: API_BASE_URL,
    headers: token ? { "x-session-token": token } : {},
  });
}
