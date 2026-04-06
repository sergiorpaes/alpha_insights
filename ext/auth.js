// ALPHA INSIGHTS PRO: Auth Manager (Chrome Extension)

export const checkAuth = async () => {
    const result = await chrome.storage.local.get(['user']);
    if (result.user) {
        updateUI(result.user);
        return result.user;
    }
    return null;
};

export const loginWithGoogle = async () => {
    try {
        const token = await new Promise((resolve, reject) => {
            chrome.identity.getAuthToken({ interactive: true }, (t) => {
                if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
                else resolve(t);
            });
        });

        // Buscar informações do perfil no Google
        const response = await fetch(`https://www.googleapis.com/oauth2/v3/userinfo?access_token=${token}`);
        const googleUser = await response.json();

        const user = {
            id: googleUser.sub,
            email: googleUser.email,
            name: googleUser.name,
            picture: googleUser.picture,
            token: token
        };

        await chrome.storage.local.set({ user });
        updateUI(user);
        return user;
    } catch (error) {
        console.error("Auth Error:", error);
        return null;
    }
};

export const logout = async () => {
    const result = await chrome.storage.local.get(['user']);
    if (result.user && result.user.token) {
        chrome.identity.removeCachedAuthToken({ token: result.user.token });
    }
    await chrome.storage.local.remove(['user']);
    window.location.reload();
};

const updateUI = (user) => {
    const overlay = document.getElementById('loginOverlay');
    const profile = document.getElementById('userProfile');
    const userName = document.getElementById('userName');
    const userImg = document.getElementById('userImg');

    if (user && overlay && profile) {
        overlay.classList.add('hidden');
        profile.classList.remove('hidden');
        userName.textContent = user.name.split(' ')[0] || 'Sair';
        userImg.src = user.picture;
    }
};
