import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
    constructor() {
        super({
            clientID: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            callbackURL: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3000/auth/google/callback',
            scope: ['email', 'profile'],
        });
    }

    async validate(accessToken: string, refreshToken: string, profile: any, done: VerifyCallback): Promise<any> {
        try {
            console.log('Google OAuth Profile:', profile);
            const { name, emails, photos } = profile;
            
            if (!emails || !emails[0]) {
                console.error('No email found in Google profile');
                return done(new Error('No email found in Google profile'), null);
            }
            
            if (!name) {
                console.error('No name found in Google profile');
                return done(new Error('No name found in Google profile'), null);
            }
            
            const user = {
                email: emails[0].value,
                primeiro_nome: name.givenName || 'Usuário',
                sobrenome: name.familyName || 'Google',
                nome: `${name.givenName || 'Usuário'} ${name.familyName || 'Google'}`,
                picture: photos && photos[0] ? photos[0].value : '',
                providerId: profile.id,
            };
            
            console.log('Google OAuth User:', user);
            done(null, user);
        } catch (error) {
            console.error('Error in Google OAuth validation:', error);
            done(error, null);
        }
    }
}
