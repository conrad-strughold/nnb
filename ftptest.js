const ftp = require("basic-ftp");

async function uploadFile() {
    const client = new ftp.Client();
    client.ftp.verbose = true; // Detailed logs

    try {
        console.log("Attempting to connect...");
        await client.access({
            host: "198.23.57.8", // Try IP directly
            user: "micsay8",
            password: "Mallorca4", // Replace this
            secure: false // Try true if FTPS is needed
        });
        console.log("Connected to FTP server");

        await client.uploadFrom("test.txt", "test.txt");
        console.log("File uploaded successfully!");
    } catch (err) {
        console.error("Detailed Error:", err);
    } finally {
        client.close();
    }
}

uploadFile();