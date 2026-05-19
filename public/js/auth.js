// ============================================================
// AUTH.JS - Sistema de autenticação global do Pou Money
// ============================================================

const Auth = (() => {
    const API = window.location.origin;

    function getToken() { return localStorage.getItem('pm_token'); }
    function getRefreshToken() { return localStorage.getItem('pm_refresh'); }

    function setSession(token, refreshToken) {
        localStorage.setItem('pm_token', token);
        if (refreshToken) localStorage.setItem('pm_refresh', refreshToken);
    }

    function clearSession() {
        localStorage.removeItem('pm_token');
        localStorage.removeItem('pm_refresh');
        localStorage.removeItem('pm_user');
    }

    async function renovarToken() {
        const refresh = getRefreshToken();
        if (!refresh) return false;
        try {
            const r = await fetch(`${API}/api/refresh-token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refreshToken: refresh })
            });
            const d = await r.json();
            if (d.success) { 
                localStorage.setItem('pm_token', d.token);
                return true;
            }
        } catch (e) {}
        return false;
    }

    async function fetchAuth(url, options = {}) {
        const token = getToken();
        if (!options.headers) options.headers = {};
        options.headers['Authorization'] = `Bearer ${token}`;

        let res = await fetch(url, options);

        if (res.status === 401) {
            const data = await res.clone().json().catch(() => ({}));
            if (data.expired) {
                const renovado = await renovarToken();
                if (renovado) {
                    options.headers['Authorization'] = `Bearer ${getToken()}`;
                    res = await fetch(url, options);
                } else {
                    clearSession();
                    window.location.href = '/login';
                    return null;
                }
            }
        }
        return res;
    }

    async function verificar() {
        const token = getToken();
        if (!token) return null;
        try {
            const r = await fetchAuth(`${API}/api/verificar`);
            if (!r) return null;
            const d = await r.json();
            if (d.autenticado) {
                localStorage.setItem('pm_user', JSON.stringify(d.user));
                return d.user;
            }
        } catch (e) {}
        return null;
    }

    async function logout() {
        const token = getToken();
        if (token) {
            try {
                await fetch(`${API}/api/logout`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}` }
                });
            } catch (e) {}
        }
        clearSession();
        window.location.href = '/';
    }

    async function checarSessaoPublica() {
        const token = getToken();
        if (!token) return;
        try {
            const r = await fetch(`${API}/api/verificar`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const d = await r.json();
            if (d.autenticado) {
                window.location.href = d.user.is_admin ? '/admin-painel' : '/jogos';
            } else {
                clearSession();
            }
        } catch (e) {}
    }

    async function exigirAuth(adminOnly = false) {
        const user = await verificar();
        if (!user) {
            clearSession();
            window.location.href = '/login';
            return null;
        }
        if (adminOnly && !user.is_admin) {
            window.location.href = '/jogos';
            return null;
        }
        if (!adminOnly && user.is_admin) {
            window.location.href = '/admin-painel';
            return null;
        }
        return user;
    }

    return { getToken, fetchAuth, verificar, logout, checarSessaoPublica, exigirAuth, setSession, clearSession, API };
})();