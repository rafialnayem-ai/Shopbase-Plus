self.addEventListener('push', e => {
    const data = e.data.json();
    self.registration.showNotification(data.title, {
        body: 'Check the app for new arrivals!',
        icon: 'https://cdn-icons-png.flaticon.com/512/1162/1162499.png'
    });
});