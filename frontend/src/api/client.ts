import axios from 'axios'

// Cookie сессии httpOnly, поэтому withCredentials обязателен
export const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
})
